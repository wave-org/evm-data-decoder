const fs = require("fs");

let indexTS = `
import { JsonFragment } from "ethers";
type ABI = JsonFragment[];
const abiList: ABI[] = [];

`;
fs.readdirSync("./src/abi").forEach((file, index) => {
  if (file.includes(".json")) {
    const path = `./src/abi/${file}`;
    const jsonFile = fs.readFileSync(path, "utf8");
    const json = JSON.parse(jsonFile);
    const outputJson = [];
    json.forEach((abi) => {
      if (
        abi.type === "function" &&
        abi.stateMutability !== "view" &&
        abi.stateMutability !== "pure"
      ) {
        // abi.outputs = [];
        outputJson.push(abi);
      }
    });

    fs.writeFileSync(path, JSON.stringify(outputJson, null, 2));
    indexTS =
      indexTS +
      `const data${index} =\`${JSON.stringify(
        outputJson
      )}\`;\nabiList.push(JSON.parse(data${index}));\n`;
  }
});

indexTS += "\nexport default abiList;\n";
fs.writeFileSync("./src/abi/index.ts", indexTS);
