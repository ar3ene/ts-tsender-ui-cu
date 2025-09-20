"use client"

import { useState, useMemo, useEffect } from "react"
import { RiAlertFill, RiInformationLine } from "react-icons/ri"
import {
    useChainId,
    useWriteContract,
    useAccount,
    useWaitForTransactionReceipt,
    useReadContracts,
} from "wagmi"
import { chainsToTSender, tsenderAbi, erc20Abi } from "@/constants"
import { readContract } from "@wagmi/core"
import { useConfig, usePublicClient } from "wagmi"
// Spinner handled in TxButton
import { calculateTotal, formatTokenAmount } from "@/utils"
import { InputForm } from "./ui/InputField"
import { Tabs, TabsList, TabsTrigger } from "./ui/Tabs"
import { waitForTransactionReceipt } from "@wagmi/core"
import { TxButton } from "./ui/TxButton"
import { useWagmiTxPhase } from "@/hooks/useWagmiTxPhase"
import { isAddress } from "viem"

interface AirdropFormProps {
    isUnsafeMode: boolean
    onModeChange: (unsafe: boolean) => void
}

export default function AirdropForm({ isUnsafeMode, onModeChange }: AirdropFormProps) {
    const [tokenAddress, setTokenAddress] = useState("")
    const [recipients, setRecipients] = useState("")
    const [amounts, setAmounts] = useState("")
    const config = useConfig()
    const account = useAccount()
    const chainId = useChainId()
    const publicClient = usePublicClient({ chainId })
    const { data: tokenData } = useReadContracts({
        contracts: [
            {
                abi: erc20Abi,
                address: isAddress(tokenAddress) ? (tokenAddress as `0x${string}`) : undefined,
                functionName: "decimals",
                chainId,
            },
            {
                abi: erc20Abi,
                address: isAddress(tokenAddress) ? (tokenAddress as `0x${string}`) : undefined,
                functionName: "name",
                chainId,
            },
            {
                abi: erc20Abi,
                address: isAddress(tokenAddress) ? (tokenAddress as `0x${string}`) : undefined,
                functionName: "balanceOf",
                args: account.address ? [account.address] : undefined,
                chainId,
            },
        ],
        query: { enabled: isAddress(tokenAddress) },
    })
    const [hasEnoughTokens, setHasEnoughTokens] = useState(true)

    const { data: hash, isPending, error, writeContractAsync } = useWriteContract()
    const { isLoading: isConfirming, isSuccess: isConfirmed, isError } = useWaitForTransactionReceipt({
        confirmations: 1,
        hash,
    })

    const total: number = useMemo(() => calculateTotal(amounts), [amounts])

    // Map wagmi states to generic phases for UI
    const { phase, isBusy } = useWagmiTxPhase({
        isPending,
        isConfirming,
        isSuccess: isConfirmed,
        isError: Boolean(error) || isError,
    })

    // track current logical step to customize labels
    const [txStep, setTxStep] = useState<"approve" | "airdrop" | null>(null)


    async function handleSubmit() {
        const contractType = isUnsafeMode ? "no_check" : "tsender"
        const tSenderAddress = chainsToTSender[chainId][contractType]
        const recipientsArray = recipients.split(/[\,\n]+/).map(a => a.trim()).filter(Boolean)
        const amountsArray = amounts.split(/[\,\n]+/).map(a => a.trim()).filter(Boolean)
        console.groupCollapsed("[TSender] Airdrop submit")
        console.log("chainId:", chainId)
        console.log("owner:", account.address)
        console.log("token:", tokenAddress)
        console.log("tSender:", tSenderAddress)
        console.log("recipients:", recipientsArray.length)
        console.log("amounts:", amountsArray.length)
        console.log("total:", String(BigInt(total)))
        const sampleCount = Math.min(3, recipientsArray.length, amountsArray.length)
        if (sampleCount > 0) {
            const samples = Array.from({ length: sampleCount }, (_, i) => ({
                index: i,
                recipient: recipientsArray[i],
                amount: amountsArray[i],
            }))
            console.table(samples)
        }

            // Safe mode: bytecode precheck to ensure current RPC has code
            if (!isUnsafeMode && isAddress(tokenAddress)) {
                try {
                    const codeByPublic = await publicClient?.getBytecode({ address: tokenAddress as `0x${string}` }).catch(() => null)
                    if (!codeByPublic) {
                        console.error("[TSender] No bytecode at token on current RPC. Ensure RainbowKit network uses the same Anvil RPC as deployment. Abort (safe mode).")
                        console.groupEnd()
                        return
                    }
                } catch (e) {
                    console.warn("[TSender] Bytecode precheck failed:", e)
                }
            }

        // Decimals unreadable: warn but continue; rely on allowance logic
        const hasDecimals = Boolean(tokenData?.[0]?.result)
        if (!hasDecimals) {
            console.warn("[TSender] Token decimals unreadable. Proceeding; will rely on allowance check.")
        }

        // Sample: read before balances for first 3 recipients
        const sampleRecipients = recipientsArray.slice(0, sampleCount)
        const beforeBalances = await Promise.all<bigint>(
            sampleRecipients.map((addr) =>
                (readContract(config, {
                    abi: erc20Abi,
                    address: tokenAddress as `0x${string}`,
                    functionName: "balanceOf",
                    args: [addr as `0x${string}`],
                    chainId,
                }) as Promise<bigint>).catch(() => BigInt(0))
            )
        )
        const approved = await getApprovedAmount(tSenderAddress)

        // Helper to send the airdrop call
        const sendAirdrop = async () => {
            setTxStep("airdrop")
            console.log("Submitting airdrop tx...")
            const airdropHash = await writeContractAsync({
                abi: tsenderAbi,
                address: tSenderAddress as `0x${string}`,
                functionName: "airdropERC20",
                args: [
                    tokenAddress,
                    recipientsArray,
                    amountsArray,
                    BigInt(total),
                ],
            })
            console.log("Airdrop tx submitted:", airdropHash)
            return airdropHash
        }

        // If allowance unreadable:
        //  - Safe mode: abort
        //  - Unsafe mode: try airdrop-first; if it fails, fallback to approve+airdrop
        if (approved === null) {
            if (!isUnsafeMode) {
                console.error("[TSender] Allowance unreadable. Abort (safe mode).")
                console.groupEnd()
                return
            }
            console.log("Allowance unknown (read failed). Trying airdrop-first (unsafe mode)...")
            try {
                const hash = await sendAirdrop()
                const receipt = await waitForTransactionReceipt(config, { hash })
                console.log("[TSender] Final tx confirmed:", receipt.transactionHash)
                await logSampleDeltas({
                    config,
                    chainId,
                    tokenAddress: tokenAddress as `0x${string}`,
                    recipients: sampleRecipients,
                    beforeBalances,
                    amounts: amountsArray.slice(0, sampleRecipients.length),
                })
                console.groupEnd()
                return
            } catch {
                console.log("Airdrop-first failed. Will approve then retry.")
            }
        }

        if (approved === null || approved < BigInt(total)) {
            console.log("Allowance insufficient. Approving:", String(BigInt(total)))
            setTxStep("approve")
            const approvalHash = await writeContractAsync({
                abi: erc20Abi,
                address: tokenAddress as `0x${string}`,
                functionName: "approve",
                args: [tSenderAddress as `0x${string}`, BigInt(total)],
            })
            console.log("Approval tx submitted:", approvalHash)
            await waitForTransactionReceipt(config, { hash: approvalHash })
            console.log("Approval confirmed")
            const hash = await sendAirdrop()
            const receipt = await waitForTransactionReceipt(config, { hash })
            console.log("[TSender] Final tx confirmed:", receipt.transactionHash)
            await logSampleDeltas({
                config,
                chainId,
                tokenAddress: tokenAddress as `0x${string}`,
                recipients: sampleRecipients,
                beforeBalances,
                amounts: amountsArray.slice(0, sampleRecipients.length),
            })
        } else {
            console.log("Allowance sufficient. Skipping approve.")
            const hash = await sendAirdrop()
            const receipt = await waitForTransactionReceipt(config, { hash })
            console.log("[TSender] Final tx confirmed:", receipt.transactionHash)
            await logSampleDeltas({
                config,
                chainId,
                tokenAddress: tokenAddress as `0x${string}`,
                recipients: sampleRecipients,
                beforeBalances,
                amounts: amountsArray.slice(0, sampleRecipients.length),
            })
        }
        console.groupEnd()
    }

    async function getApprovedAmount(
        tSenderAddress: string | null,
    ): Promise<bigint | null> {
        if (!tSenderAddress) {
            alert("This chain only has the safer version!")
            return BigInt(0)
        }
        if (!isAddress(tokenAddress) || !account.address) {
            return BigInt(0)
        }
        try {
            console.debug("[TSender] Reading allowance", {
                owner: account.address,
                spender: tSenderAddress,
                token: tokenAddress,
                chainId,
            })
            const response = await readContract(config, {
                abi: erc20Abi,
                address: tokenAddress as `0x${string}`,
                functionName: "allowance",
                args: [account.address as `0x${string}`, tSenderAddress as `0x${string}`],
                chainId,
            })
            const value = response as bigint
            console.debug("[TSender] Allowance value:", String(value))
            return value
        } catch (e) {
            // Quiet warning and signal unknown by returning null
            console.warn("[TSender] Allowance read failed (possibly non-ERC20 or wrong chain). Trying airdrop first.", e)
            return null
        }
    }

    // Log sampled recipients' balance deltas (first few) to verify transfers
    async function logSampleDeltas(params: {
        config: ReturnType<typeof useConfig>
        chainId: number
        tokenAddress: `0x${string}`
        recipients: string[]
        beforeBalances: bigint[]
        amounts: string[]
    }) {
        const { config, chainId, tokenAddress, recipients, beforeBalances, amounts } = params
        if (recipients.length === 0) return
        const afterBalances = await Promise.all<bigint>(
            recipients.map((addr) =>
                (readContract(config, {
                    abi: erc20Abi,
                    address: tokenAddress,
                    functionName: "balanceOf",
                    args: [addr as `0x${string}`],
                    chainId,
                }) as Promise<bigint>).catch(() => BigInt(0))
            )
        )
        const rows = recipients.map((r, i) => {
            const before = beforeBalances[i] ?? BigInt(0)
            const after = afterBalances[i] ?? BigInt(0)
            const delta = after - before
            return {
                index: i,
                recipient: r,
                amountInput: amounts[i],
                before: before.toString(),
                after: after.toString(),
                delta: delta.toString(),
            }
        })
        console.table(rows)
        const anyChanged = rows.some((r) => r.delta !== "0")
        if (!anyChanged) {
            console.warn("[TSender] No sampled balance changed. Verify token is ERC-20 on this chain and inputs are correct.")
        }
    }

    // Reset step after finish
    useEffect(() => {
        if (isConfirmed) {
            console.log("[TSender] Final tx confirmed:", hash)
        }
        if (isConfirmed || isError) setTxStep(null)
    }, [isConfirmed, isError, hash])

    useEffect(() => {
        const savedTokenAddress = localStorage.getItem('tokenAddress')
        const savedRecipients = localStorage.getItem('recipients')
        const savedAmounts = localStorage.getItem('amounts')

        if (savedTokenAddress) setTokenAddress(savedTokenAddress)
        if (savedRecipients) setRecipients(savedRecipients)
        if (savedAmounts) setAmounts(savedAmounts)
    }, [])

    useEffect(() => {
        localStorage.setItem('tokenAddress', tokenAddress)
    }, [tokenAddress])

    useEffect(() => {
        localStorage.setItem('recipients', recipients)
    }, [recipients])

    useEffect(() => {
        localStorage.setItem('amounts', amounts)
    }, [amounts])

    useEffect(() => {
        const balanceResult = tokenData?.[2]?.result as unknown
        if (isAddress(tokenAddress) && total > 0 && typeof balanceResult !== "undefined") {
            const userBalance = BigInt(balanceResult as any)
            setHasEnoughTokens(userBalance >= BigInt(total))
        } else {
            setHasEnoughTokens(true)
        }
    }, [tokenAddress, total, tokenData])

    return (
        <div
            className={`max-w-2xl min-w-full xl:min-w-lg w-full lg:mx-auto p-6 flex flex-col gap-6 bg-white rounded-xl ring-[4px] border-2 ${isUnsafeMode ? " border-red-500 ring-red-500/25" : " border-blue-500 ring-blue-500/25"}`}
        >
            <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold text-zinc-900">T-Sender</h2>
                <Tabs defaultValue={"false"}>
                    <TabsList>
                        <TabsTrigger value={"false"} onClick={() => onModeChange(false)}>
                            Safe Mode
                        </TabsTrigger>
                        <TabsTrigger value={"true"} onClick={() => onModeChange(true)}>
                            Unsafe Mode
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            <div className="space-y-6">
                <InputForm
                    label="Token Address"
                    placeholder="0x"
                    value={tokenAddress}
                    onChange={e => setTokenAddress(e.target.value)}
                />
                <InputForm
                    label="Recipients (comma or new line separated)"
                    placeholder="0x123..., 0x456..."
                    value={recipients}
                    onChange={e => setRecipients(e.target.value)}
                    large={true}
                />
                <InputForm
                    label="Amounts (wei; comma or new line separated)"
                    placeholder="100, 200, 300..."
                    value={amounts}
                    onChange={e => setAmounts(e.target.value)}
                    large={true}
                />

                <div className="bg-white border border-zinc-300 rounded-lg p-4">
                    <h3 className="text-sm font-medium text-zinc-900 mb-3">Transaction Details</h3>
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-zinc-600">Token Name:</span>
                            <span className="font-mono text-zinc-900">
                                {tokenData?.[1]?.result as string}
                            </span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-zinc-600">Amount (wei):</span>
                            <span className="font-mono text-zinc-900">{total}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-sm text-zinc-600">Amount (tokens):</span>
                            <span className="font-mono text-zinc-900">
                                {formatTokenAmount(total, tokenData?.[0]?.result as number)}
                            </span>
                        </div>
                    </div>
                </div>

                {isUnsafeMode && (
                    <div className="mb-4 p-4 bg-red-50 text-red-600 rounded-lg flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <RiAlertFill size={20} />
                            <span>
                                Using{" "}
                                <span className="font-medium underline underline-offset-2 decoration-2 decoration-red-300">
                                    unsafe
                                </span>{" "}
                                super gas optimized mode
                            </span>
                        </div>
                        <div className="relative group">
                            <RiInformationLine className="cursor-help w-5 h-5 opacity-45" />
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-zinc-900 text-white text-sm rounded-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all w-64">
                                This mode skips certain safety checks to optimize for gas. Do not
                                use this mode unless you know how to verify the calldata of your
                                transaction.
                                <div className="absolute top-full left-1/2 -translate-x-1/2 -translate-y-1 border-8 border-transparent border-t-zinc-900"></div>
                            </div>
                        </div>
                    </div>
                )}

                <TxButton
                    phase={phase === "success" ? "idle" : phase}
                    onClick={handleSubmit}
                    disabled={isBusy || (!hasEnoughTokens && tokenAddress !== "")}
                    blockedLabel={!hasEnoughTokens && tokenAddress ? "Insufficient token balance" : undefined}
                    idleLabel={isUnsafeMode ? "Send Tokens (Unsafe)" : "Send Tokens"}
                    walletLabel={txStep === "approve" ? "Confirming approval in wallet..." : "Confirming in wallet..."}
                    miningLabel={txStep === "approve" ? "Approving token..." : "Waiting for transaction to be included..."}
                    className={`cursor-pointer flex items-center justify-center w-full py-3 rounded-[9px] text-white transition-colors font-semibold relative border ${isUnsafeMode
                        ? "bg-red-500 hover:bg-red-600 border-red-500"
                        : "bg-blue-500 hover:bg-blue-600 border-blue-500"
                        } ${!hasEnoughTokens && tokenAddress ? "opacity-50 cursor-not-allowed" : ""}`}
                />
            </div>
        </div>
    )
}
