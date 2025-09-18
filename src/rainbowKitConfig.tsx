"use client"

import { getDefaultConfig } from "@rainbow-me/rainbowkit"
import { http } from "@wagmi/core"
import { arbitrum, base, mainnet, optimism, anvil, zksync, sepolia } from "wagmi/chains"

export default getDefaultConfig({
    appName: "TSender",
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
    chains: [mainnet, optimism, arbitrum, base, zksync, sepolia, anvil],
    transports: {
        [anvil.id]: http("http://127.0.0.1:8545"),
    },
    ssr: false,
})
