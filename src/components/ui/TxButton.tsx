import React from "react"
import { CgSpinner } from "react-icons/cg"
import type { TxPhase } from "@/hooks/useWagmiTxPhase"

type Props = {
  phase: TxPhase
  onClick?: () => void
  disabled?: boolean
  className?: string

  idleLabel: string
  walletLabel?: string
  miningLabel?: string
  successLabel?: string
  errorLabel?: string
  blockedLabel?: string
}

export function TxButton({
  phase,
  onClick,
  disabled,
  className,
  idleLabel,
  walletLabel = "Confirming in wallet...",
  miningLabel = "Waiting for transaction to be included...",
  successLabel = "Transaction confirmed.",
  errorLabel = "Error, see console.",
  blockedLabel,
}: Props) {
  const showSpinner = phase === "wallet" || phase === "mining"

  let label = idleLabel
  if (phase === "wallet") label = walletLabel
  else if (phase === "mining") label = miningLabel
  else if (phase === "success") label = successLabel
  else if (phase === "error") label = errorLabel
  else if (blockedLabel && disabled) label = blockedLabel

  return (
    <button className={className} onClick={onClick} disabled={disabled}>
      {/* Gradient */}
      <div className="absolute w-full inset-0 bg-gradient-to-b from-white/25 via-80% to-transparent mix-blend-overlay z-10 rounded-lg" />
      {/* Inner shadow */}
      <div className="absolute w-full inset-0 mix-blend-overlay z-10 inner-shadow rounded-lg" />
      {/* White inner border */}
      <div className="absolute w-full inset-0 mix-blend-overlay z-10 border-[1.5px] border-white/20 rounded-lg" />

      {showSpinner ? (
        <div className="flex items-center justify-center gap-2 w-full">
          <CgSpinner className="animate-spin" size={20} />
          <span>{label}</span>
        </div>
      ) : (
        label
      )}
    </button>
  )
}
