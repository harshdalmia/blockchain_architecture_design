const fs = require("fs");
const { ethers } = require("hardhat");
async function main() {
  const [insurer, auditor, holder] = await ethers.getSigners();
  const c = await ethers.deployContract("InsuranceClaims", [auditor.address], { value: ethers.parseEther("50") });
  await c.waitForDeployment();
  const addr = await c.getAddress();
  const art = require("../artifacts/contracts/InsuranceClaims.sol/InsuranceClaims.json");
  fs.writeFileSync("frontend/dist/config.json", JSON.stringify({
    address: addr, abi: art.abi, rpc: "http://127.0.0.1:8545",
    accounts: { insurer: insurer.address, auditor: auditor.address, holder: holder.address },
  }));
  console.log("InsuranceClaims deployed to:", addr);
  console.log("Insurer :", insurer.address);
  console.log("Auditor :", auditor.address);
  console.log("Holder  :", holder.address);
  console.log("Pool funded with 50.0 ETH");
}
main().catch((e) => { console.error(e); process.exit(1); });
