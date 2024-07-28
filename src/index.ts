import { FunctionFragment, Interface, ParamType, Result } from "ethers";

import abiList from "./abi";

export type InputData = {
  // Items in array don't have names
  name: string;
  type: string;
  value: string | InputData[];
};

export type Function = {
  name: string;
  // minimal format of function as key
  miniFormat: string;
  inputData: InputData[];
};

export type MiniFormatFunction = string;

export type InputDataType = string | string[];

export type FunctionHeader = {
  signature: string;
  miniFormat: MiniFormatFunction;
};

export type FunctionData = {
  miniFormat: MiniFormatFunction;
  data: string;
};

export interface ABIDatabase {
  loadAllFunctionHeaders(): Promise<FunctionHeader[]>;
  saveFunctionHeaders(headers: FunctionHeader[]): Promise<void>;
  saveFunctionData(data: FunctionData[]): Promise<void>;
  getFunctionData(miniFormat: MiniFormatFunction): Promise<string | null>;
  reomveAllData(): Promise<void>;
}

export class EVMInputDataDecoder {
  // value is a list of minimum format of function
  private signatureMap: Map<string, MiniFormatFunction[]> = new Map();
  // use minimal format of function as key to check if this type of function is already loaded
  private functionKeyMap: Map<MiniFormatFunction, boolean> = new Map();
  // cache function fragments for loaded functions
  private functionsCache: Map<MiniFormatFunction, FunctionFragment> = new Map();
  public database: ABIDatabase | null; // TODO

  constructor(database: ABIDatabase | null = null) {
    this.database = database;
  }

  private loaded = false;
  public async loadAllABI() {
    if (this.loaded) {
      return;
    }
    this.loadBundledABI();
    this.loaded = true;
    await this.loadABIFromDatabase();
  }

  private loadBundledABI() {
    for (let i = 0; i < abiList.length; i++) {
      const abi = abiList[i];
      const contract = new Interface(abi);
      contract.forEachFunction((fragment) => {
        const miniFormat = fragment.format("minimal");
        if (this.functionKeyExists(miniFormat)) {
          return;
        }
        const sig = fragment.selector;
        let list = this.signatureMap.get(sig);
        if (list === undefined) {
          list = [];
        }
        list.push(miniFormat);
        this.signatureMap.set(sig, list);

        this.functionsCache.set(miniFormat, fragment);
      });
    }
    this.bundledFunctionCount = this.functionKeyMap.size;
  }

  public async loadABIFromDatabase() {
    if (this.database !== null) {
      const list = await this.database.loadAllFunctionHeaders();
      for (let i = 0; i < list.length; i++) {
        const header = list[i];
        if (this.functionKeyExists(header.miniFormat)) {
          return;
        }
        let miniFormats = this.signatureMap.get(header.signature);
        if (miniFormats === undefined) {
          miniFormats = [];
        }
        miniFormats.push(header.miniFormat);
        this.signatureMap.set(header.signature, miniFormats);
      }
    }
  }

  public async importABI(abi: string) {
    const contract = new Interface(abi);
    const headers: FunctionHeader[] = [];
    const data: FunctionData[] = [];
    contract.forEachFunction((fragment) => {
      const miniFormat = fragment.format("minimal");
      if (this.functionKeyExists(miniFormat)) {
        return;
      }
      const sig = fragment.selector;
      let list = this.signatureMap.get(sig);
      if (list === undefined) {
        list = [];
      }
      list.push(miniFormat);
      this.signatureMap.set(sig, list);
      this.functionsCache.set(miniFormat, fragment);

      headers.push({
        signature: sig,
        miniFormat,
      });
      data.push({
        miniFormat,
        data: fragment.format("json"),
      });
    });
    if (this.database !== null && headers.length > 0) {
      await this.database.saveFunctionHeaders(headers);
      await this.database.saveFunctionData(data);
    }
  }

  private functionKeyExists(miniFormat: MiniFormatFunction) {
    if (this.functionKeyMap.get(miniFormat) === true) {
      return true;
    }
    this.functionKeyMap.set(miniFormat, true);
    return false;
  }

  public async deleteSavedABI() {
    if (this.database !== null) {
      await this.database.reomveAllData();
    }
  }

  public async decodeInputData(inputData: string): Promise<Function[]> {
    inputData = inputData.trim();
    if (inputData.length < 10) {
      throw new Error("Invalid input data");
    }
    const signature = inputData.slice(0, 10).toLowerCase();
    // try to match the signature
    const miniFormats = this.signatureMap.get(signature);
    if (miniFormats === undefined || miniFormats.length === 0) {
      console.log("signature not found: " + signature);
      return [];
    }

    let functions: Function[] = [];
    for (let miniFormat of miniFormats) {
      let fragment = this.functionsCache.get(miniFormat);
      if (fragment === undefined) {
        if (this.database === null) {
          throw new Error("Database not found");
        }
        const data = await this.database!.getFunctionData(miniFormat);
        if (data === null) {
          throw new Error("Function data not found in database");
        }
        fragment = FunctionFragment.from(data);
        if (fragment === null) {
          throw new Error("Failed to parse function data");
        }
        this.functionsCache.set(miniFormat, fragment);
      }

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
            value: decodeArrayData(input, fragment!.inputs[i]),
          });
        } else {
          throw new Error("unknown type : " + typeof input);
        }
      });
      functions.push({
        miniFormat: miniFormat,
        name: fragment.name,
        inputData: result,
      });
    }

    return functions;
  }

  private bundledFunctionCount = 0;
  public functionCount(): number {
    return this.functionKeyMap.size;
  }

  public importedFunctionCount(): number {
    return this.functionKeyMap.size - this.bundledFunctionCount;
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
