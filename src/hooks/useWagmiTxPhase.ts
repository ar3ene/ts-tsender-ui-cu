import { useMemo } from "react"

export type TxPhase = "idle" | "wallet" | "mining" | "success" | "error"

export function useWagmiTxPhase(params: {
  isPending?: boolean
  isConfirming?: boolean
  isSuccess?: boolean
  isError?: boolean
}) {
  const { isPending, isConfirming, isSuccess, isError } = params

  const phase: TxPhase = useMemo(() => {
    if (isPending) return "wallet"      // waiting for user to confirm in wallet
    if (isConfirming) return "mining"   // tx sent, waiting for inclusion
    if (isError) return "error"
    if (isSuccess) return "success"
    return "idle"
  }, [isPending, isConfirming, isError, isSuccess])

  const isBusy = phase === "wallet" || phase === "mining"

  const defaultLabel = useMemo(() => {
    switch (phase) {
      case "wallet":
        return "Confirming in wallet..."
      case "mining":
        return "Waiting for transaction to be included..."
      case "success":
        return "Transaction confirmed."
      case "error":
        return "Error, see console."
      default:
        return ""
    }
  }, [phase])

  return { phase, isBusy, defaultLabel }
}
