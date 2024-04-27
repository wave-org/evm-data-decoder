
import { JsonFragment } from "ethers";
type ABI = JsonFragment[];
const abiList: ABI[] = [];

import data0 from "./1inchV6.json";
abiList.push(data0);
import data1 from "./aave.json";
abiList.push(data1);
import data2 from "./erc20Permit.json";
abiList.push(data2);
import data4 from "./uni-UniversalRouter.json";
abiList.push(data4);
import data5 from "./uniswapV2.json";
abiList.push(data5);
import data6 from "./uniswapV3.json";
abiList.push(data6);

export default abiList;
