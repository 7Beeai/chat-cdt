/**
 * Estado vazio da thread de vendas — mostrado quando nenhuma conversa está
 * selecionada. A lista persistente vive no layout da área.
 */
export default function VendasIndexPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3.5 px-6 text-center">
      <p className="text-[15px] font-semibold text-foreground">
        Selecione uma conversa
      </p>
      <p className="max-w-sm text-[12.5px] text-muted-foreground">
        Aqui você acompanha, ao vivo e somente leitura, as conversas que a IA
        de vendas está conduzindo.
      </p>
    </div>
  )
}
