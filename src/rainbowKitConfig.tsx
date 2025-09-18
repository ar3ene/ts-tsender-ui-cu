"use client"

import { getDefaultConfig } from "@rainbow-me/rainbowkit"
import { http } from "@wagmi/core"
import { arbitrum, base, mainnet, optimism, anvil, zksync, sepolia } from "wagmi/chains"

const isDev = process.env.NODE_ENV !== "production"

export default getDefaultConfig({
    appName: "TSender",
    projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID!,
    chains: [mainnet, optimism, arbitrum, base, zksync, sepolia, anvil],
    transports: isDev ? { [anvil.id]: http("http://127.0.0.1:8545") } : undefined,
    ssr: false,
})
