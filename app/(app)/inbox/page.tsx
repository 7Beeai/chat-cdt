/**
 * Empty thread state — shown in the thread region when no conversation is
 * selected. The persistent list lives in the inbox layout, so this only fills
 * the right side.
 */
export default function InboxIndexPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-6 text-center">
      <p className="text-[15px] font-semibold text-foreground">
        Selecione uma conversa
      </p>
    </div>
  )
}
