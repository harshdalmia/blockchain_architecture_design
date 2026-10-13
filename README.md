# Blockchain-Based Decentralized Insurance Claim Processing & Fraud Prevention

Prototype: Solidity smart contract + Hardhat local Ethereum testnet + React/ethers.js frontend.
Claim documents are hashed to IPFS CIDs; only the CID is stored on-chain.

    npm install
    npx hardhat test                                  # 19 tests
    npx hardhat node                                  # terminal 1
    npx hardhat run --network localhost scripts/deploy.js
    npx esbuild frontend/src/main.jsx --bundle --outfile=frontend/dist/bundle.js --format=iife --define:process.env.NODE_ENV='"production"' --loader:.js=jsx
    node frontend/server.mjs                          # http://localhost:5173
