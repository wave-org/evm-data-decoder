import { FunctionFragment, Interface, ParamType, Result } from "ethers";

import abiList from "./abi";

export type InputData = {
  // Items in array don't have names
  name: string;
  type: string;
  value: string | InputData[];
};

export type Call = {
  method: string;
  inputData: InputData[];
};

export type InputDataType = string | string[];

export interface ABIDatabase {
  saveABI(abi: string): Promise<void>;
  loadAllABI(): Promise<string[]>;
  deleteAllABI(): Promise<void>;
}

export class EVMInputDataDecoder {
  private signatureMap: Map<string, FunctionFragment[]> = new Map();
  // use minimal format of function as key to check if this type of function is already loaded
  private functionKeyMap: Map<string, boolean> = new Map();
  public database: ABIDatabase | null; // TODO

  constructor(database: ABIDatabase | null = null) {
    this.database = database;
  }

  private loaded = false;
  public async loadAllABI() {
    if (this.loaded) {
      return;
    }
    this.loadPackedABI();
    this.loaded = true;
    await this.loadABIFromDatabase();
  }

  public loadPackedABI() {
    for (let i = 0; i < abiList.length; i++) {
      const abi = abiList[i];
      const contract = new Interface(abi);
      contract.forEachFunction((fragment) => {
        if (this.functionKeyExists(fragment)) {
          return;
        }
        const sig = fragment.selector;
        let list = this.signatureMap.get(sig);
        if (list === undefined) {
          list = [];
        }
        list.push(fragment);
        this.signatureMap.set(sig, list);
      });
    }
  }

  public async loadABIFromDatabase() {
    if (this.database !== null) {
      const list = await this.database.loadAllABI();
      for (let i = 0; i < list.length; i++) {
        const abi = list[i];
        const contract = new Interface(abi);
        contract.forEachFunction((fragment) => {
          if (this.functionKeyExists(fragment)) {
            return;
          }
          const sig = fragment.selector;
          let list = this.signatureMap.get(sig);
          if (list === undefined) {
            list = [];
          }
          list.push(fragment);
          this.signatureMap.set(sig, list);
        });
      }
    }
  }

  public async importABI(abi: string) {
    const contract = new Interface(abi);
    contract.forEachFunction((fragment) => {
      if (this.functionKeyExists(fragment)) {
        return;
      }
      const sig = fragment.selector;
      let list = this.signatureMap.get(sig);
      if (list === undefined) {
        list = [];
      }
      list.push(fragment);
      this.signatureMap.set(sig, list);
    });
    if (this.database !== null) {
      await this.database.saveABI(abi);
    }
  }

  private functionKeyExists(fragment: FunctionFragment) {
    const key = fragment.format("minimal");
    if (this.functionKeyMap.get(key) === true) {
      return true;
    }
    this.functionKeyMap.set(key, true);
    return false;
  }

  public async deleteSavedABI() {
    if (this.database !== null) {
      await this.database.deleteAllABI();
    }
  }

  public decodeInputData(inputData: string): Call[] {
    inputData = inputData.trim();
    if (inputData.length < 10) {
      throw new Error("Invalid input data");
    }
    const signature = inputData.slice(0, 10).toLowerCase();
    // try to match the signature
    const fragments = this.signatureMap.get(signature);
    if (fragments === undefined || fragments.length === 0) {
      console.log("signature not found: " + signature);
      return [];
    }

    let calls: Call[] = [];
    fragments.forEach((fragment) => {
      let types = fragment.inputs.map((x) => x.type);
      const ifc = new Interface([]);
      let decodeResult = ifc.decodeFunctionData(fragment, inputData);
      const names = fragment.inputs.map((x) => x.name);

      let result: InputData[] = [];
      names.forEach((name, i) => {
        let input = decodeResult![i];
        if (typeof input === "string") {
          result.push({
            name,
            type: types[i],
            value: parseNumber(input),
          });
        } else if (typeof input === "bigint") {
          result.push({
            name,
            type: types[i],
            value: input.toString(),
          });
        } else if (Array.isArray(input)) {
          result.push({
            name,
            type: types[i],
            value: decodeArrayData(input, fragment.inputs[i]),
          });
        } else {
          throw new Error("unknown type : " + typeof input);
        }
      });
      calls.push({
        method: fragment.name,
        inputData: result,
      });
    });

    return calls;
  }
}

function decodeArrayData(inputs: any, paramType: ParamType) {
  let items: InputData[] = [];
  if (paramType.arrayChildren !== null) {
    // array
    const childrenType = paramType.arrayChildren;
    inputs.forEach((input, index) => {
      let value = input;
      if (childrenType.type === "tuple" || childrenType.type.includes("]")) {
        value = decodeArrayData(value, childrenType);
      } else {
        value = parseNumber(value);
      }

      items.push({
        name: `${paramType.name}[${index}]`,
        type: childrenType.type,
        value: value,
      });
    });
  } else if (paramType.components !== null) {
    // tuple
    paramType.components.forEach((c, j) => {
      let value = inputs[j];
      if (c.type === "tuple" || c.type.includes("]")) {
        value = decodeArrayData(value, c);
      } else {
        value = parseNumber(value);
      }

      items.push({
        name: c.name,
        type: c.type,
        value: value,
      });
    });
  }
  return items;
}

function parseNumber(value: any) {
  if (typeof value === "bigint") {
    return value.toString();
  }
  return value;
}
