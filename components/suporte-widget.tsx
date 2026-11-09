'use client'

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { LifeBuoy, X, Send, ThumbsUp, ThumbsDown, Loader2 } from 'lucide-react';
import { useUnitFilter } from '@/components/inbox/unit-filter';
import { createClient } from '@/lib/supabase/client';

// Suporte 7Bee — widget "Ajuda". Fala com a edge function `suporte-agent`, que
// responde só com a base de conhecimento (suporte_kb) e ferramentas de LEITURA
// sob o RLS do usuário logado. Conversa por unidade, guardada no navegador por até 12h.
// Versão do Chat CDT (origem: 'chat'); a do Dashboard vive em new-dashboard-cdt/src/components/SuporteWidget.tsx.
// Spec: cpt-ibirite/docs/SPEC-AGENTE-SUPORTE-7BEE-2026-09-08.md

type Msg = { id?: number | null; papel: 'user' | 'assistant'; texto: string; protocolo?: string | null; feedback?: boolean | null };

const SUGESTOES: Record<string, string[]> = {
  '/inbox': ['Como reabrir conversa fora da janela de 24h?', 'Quando a IA devolve o cliente para a equipe?', 'Cliente pagou e não aparece'],
  '/vendas': ['Como funciona o Agente de Vendas?', 'Quando o lead vem para a equipe?'],
};
const SUGESTOES_PADRAO = ['Como reabrir conversa fora da janela de 24h?', 'Cliente pagou e não aparece', 'A lista de hoje entrou?'];

function sessionKey(unitId: string) { return `suporte.session.${unitId}`; }

// A conversa sobrevive a recarregar a página: fica no navegador, por unidade, por até 12h.
const CONVERSA_TTL_MS = 12 * 60 * 60 * 1000;
const UI_KEY = 'suporte.ui';
function conversaKey(unitId: string) { return `suporte.conversa.${unitId}`; }
function lerConversa(unitId: string): Msg[] {
  try {
    const raw = localStorage.getItem(conversaKey(unitId));
    if (!raw) return [];
    const { ts, msgs } = JSON.parse(raw) as { ts: number; msgs: Msg[] };
    if (!Array.isArray(msgs) || Date.now() - ts > CONVERSA_TTL_MS) { limparConversa(unitId); return []; }
    return msgs;
  } catch { return []; }
}
function gravarConversa(unitId: string, msgs: Msg[]) {
  try { localStorage.setItem(conversaKey(unitId), JSON.stringify({ ts: Date.now(), msgs: msgs.slice(-60) })); } catch { /* sem storage */ }
}
function limparConversa(unitId: string) {
  try { localStorage.removeItem(conversaKey(unitId)); sessionStorage.removeItem(sessionKey(unitId)); localStorage.removeItem(sessionKey(unitId)); } catch { /* ignore */ }
}
function lerUi(): { open?: boolean; unit?: string | null } {
  try { return JSON.parse(sessionStorage.getItem(UI_KEY) ?? '{}'); } catch { return {}; }
}

export function SuporteWidget({ isAdmin }: { isAdmin: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const pathname = usePathname();
  const { units, selectedUnit } = useUnitFilter();
  const todasUnidades = useMemo(
    () => units.map((u) => ({ unit_id: u.id, unit_code: u.code, unit_name: u.name })),
    [units],
  );
  const currentUnit = selectedUnit?.code ?? null;
  // Abertura gradual: o widget só existe nas unidades com units.suporte_widget_enabled
  // (admin 7Bee: todas). A mesma regra é conferida no servidor (suporte_check_access).
  const [habilitadas, setHabilitadas] = useState<string[] | null>(null);
  useEffect(() => {
    if (!todasUnidades.length) return;
    let vivo = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.rpc as any)('suporte_unidades_habilitadas').then(({ data, error }: { data: string[] | null; error: unknown }) => {
      if (vivo) setHabilitadas(error || !Array.isArray(data) ? null : data);
    });
    return () => { vivo = false; };
  }, [todasUnidades]);
  const availableUnits = useMemo(
    () => (habilitadas ? todasUnidades.filter((u) => habilitadas.includes(u.unit_id)) : isAdmin ? todasUnidades : []),
    [todasUnidades, habilitadas, isAdmin],
  );
  const [open, setOpen] = useState(() => !!lerUi().open);
  const [input, setInput] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);
  const [unitOverride, setUnitOverride] = useState<string | null>(() => lerUi().unit ?? null);
  const [escolhendo, setEscolhendo] = useState(false);
  const [filtro, setFiltro] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const pagina = pathname || '/';
  // Na conversa aberta em tela pequena o botão cobriria o enviar do composer.
  const naThread = /^\/inbox\/[^/]+/.test(pagina);
  const unit = useMemo(() => {
    const code = unitOverride ?? currentUnit;
    const u = code ? availableUnits.find((x) => x.unit_code === code) : null;
    return u ?? null;
  }, [currentUnit, unitOverride, availableUnits]);
  const unidadesFiltradas = useMemo(() => {
    const f = filtro.trim().toLowerCase();
    const lista = [...availableUnits].sort((a, b) => a.unit_name.localeCompare(b.unit_name, 'pt-BR'));
    return f ? lista.filter((u) => u.unit_name.toLowerCase().includes(f)) : lista;
  }, [availableUnits, filtro]);

  // Ao trocar de unidade, recupera a sessão dela (se houver)
  useEffect(() => {
    // localStorage só existe no navegador: hidratar a conversa precisa ser num effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMsgs(unit ? lerConversa(unit.unit_id) : []);
  }, [unit?.unit_id]);

  useEffect(() => {
    if (unit && msgs.length) gravarConversa(unit.unit_id, msgs);
  }, [msgs, unit?.unit_id]);

  useEffect(() => {
    try { sessionStorage.setItem(UI_KEY, JSON.stringify({ open, unit: unitOverride })); } catch { /* ignore */ }
  }, [open, unitOverride]);

  function novaConversa() {
    if (!unit || busy) return;
    limparConversa(unit.unit_id);
    setMsgs([]);
  }

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [msgs, busy]);

  const sugestoes = SUGESTOES[Object.keys(SUGESTOES).find((k) => pagina.startsWith(k)) ?? ''] ?? SUGESTOES_PADRAO;

  // Sem unidade liberada (e sem ser admin), o widget não aparece.
  if (!availableUnits.length) return null;

  async function enviar(texto: string) {
    const t = texto.trim();
    if (!t || busy || !unit) return;
    setInput('');
    setMsgs((m) => [...m, { papel: 'user', texto: t }]);
    setBusy(true);
    try {
      let sessionId: string | null = null;
      try { sessionId = localStorage.getItem(sessionKey(unit.unit_id)); } catch { /* sem storage */ }
      const { data, error } = await supabase.functions.invoke('suporte-agent', {
        body: { message: t, unit_id: unit.unit_id, origem: 'chat', pagina, session_id: sessionId },
      });
      if (error || !data?.reply) {
        setMsgs((m) => [...m, { papel: 'assistant', texto: 'Não consegui responder agora. Tente de novo em instantes ou chame o Suporte no grupo.' }]);
        return;
      }
      try { if (data.session_id) localStorage.setItem(sessionKey(unit.unit_id), data.session_id); } catch { /* ignore */ }
      setMsgs((m) => [...m, { id: data.message_id, papel: 'assistant', texto: data.reply, protocolo: data.protocolo ?? null, feedback: null }]);
    } finally {
      setBusy(false);
    }
  }

  async function feedback(idx: number, util: boolean) {
    const m = msgs[idx];
    if (!m?.id || !unit) return;
    let sessionId: string | null = null;
    try { sessionId = localStorage.getItem(sessionKey(unit.unit_id)); } catch { /* ignore */ }
    setMsgs((all) => all.map((x, i) => (i === idx ? { ...x, feedback: util } : x)));
    await supabase.functions.invoke('suporte-agent', { body: { action: 'feedback', message_id: m.id, session_id: sessionId, util } });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? 'Fechar ajuda' : 'Abrir ajuda'}
        className={`fixed bottom-5 right-5 z-50 ${naThread ? 'hidden lg:flex' : 'flex'} items-center gap-2 rounded-full border border-border bg-card px-4 py-2.5 text-sm font-medium text-foreground shadow-lg hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
      >
        <LifeBuoy className="h-4 w-4" />
        Ajuda
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Suporte 7Bee"
          className="fixed bottom-20 right-5 z-50 flex h-[min(620px,calc(100vh-6.5rem))] w-[min(400px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-card text-foreground shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold">Suporte 7Bee</div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="truncate">{unit && !escolhendo ? unit.unit_name : 'Escolha a unidade para começar'}</span>
                {unit && !escolhendo && availableUnits.length > 1 && (
                  <button type="button" onClick={() => { setFiltro(''); setEscolhendo(true); }} className="shrink-0 underline hover:text-foreground">trocar</button>
                )}
                {unit && !escolhendo && msgs.length > 0 && (
                  <button type="button" onClick={novaConversa} className="shrink-0 underline hover:text-foreground">nova conversa</button>
                )}
              </div>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Fechar" className="rounded p-1 text-muted-foreground hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          </div>

          {!unit || escolhendo ? (
            <div className="flex min-h-0 flex-1 flex-col gap-2 p-4 text-sm">
              <p className="text-muted-foreground">O Suporte responde com os dados de uma unidade. Qual?</p>
              <input
                autoFocus
                value={filtro}
                onChange={(e) => setFiltro(e.target.value)}
                placeholder="Buscar unidade"
                className="rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain pr-1">
                {unidadesFiltradas.map((u) => (
                  <button key={u.unit_code} type="button" onClick={() => { setUnitOverride(u.unit_code); setEscolhendo(false); }}
                    className="shrink-0 rounded-md border border-border px-3 py-2 text-left hover:bg-accent">
                    {u.unit_name}
                  </button>
                ))}
                {unidadesFiltradas.length === 0 && <p className="text-muted-foreground">Nenhuma unidade com esse nome.</p>}
              </div>
            </div>
          ) : (
            <>
              <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-4 py-3 text-sm">
                {msgs.length === 0 && (
                  <div className="flex flex-col gap-2">
                    <p className="text-muted-foreground">
                      Pergunte sobre a lista, pagamentos, baixas, Chat CDT ou uma matrícula. Eu respondo com a regra e com os dados da unidade; o que eu não souber, abro um chamado.
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {sugestoes.map((s) => (
                        <button key={s} type="button" onClick={() => enviar(s)}
                          className="rounded-full border border-border px-3 py-1 text-xs hover:bg-accent">
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {msgs.map((m, i) => (
                  <div key={i} className={m.papel === 'user' ? 'self-end max-w-[85%]' : 'self-start max-w-[92%]'}>
                    <div className={
                      m.papel === 'user'
                        ? 'rounded-2xl rounded-br-sm bg-primary px-3 py-2 text-primary-foreground whitespace-pre-wrap'
                        : 'rounded-2xl rounded-bl-sm bg-muted px-3 py-2 whitespace-pre-wrap'
                    }>
                      {m.texto}
                    </div>
                    {m.papel === 'assistant' && (
                      <div className="mt-1 flex items-center gap-2 text-[11px] text-muted-foreground">
                        {m.protocolo && <span className="rounded bg-accent px-1.5 py-0.5 font-mono">chamado {m.protocolo}</span>}
                        {m.id && m.feedback == null && (
                          <>
                            <button type="button" aria-label="Ajudou" onClick={() => feedback(i, true)} className="hover:text-foreground"><ThumbsUp className="h-3.5 w-3.5" /></button>
                            <button type="button" aria-label="Não ajudou" onClick={() => feedback(i, false)} className="hover:text-foreground"><ThumbsDown className="h-3.5 w-3.5" /></button>
                          </>
                        )}
                        {m.feedback === true && <span>obrigado!</span>}
                        {m.feedback === false && <span>anotado; o Suporte vai revisar</span>}
                      </div>
                    )}
                  </div>
                ))}
                {busy && (
                  <div className="self-start flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> consultando…
                  </div>
                )}
              </div>
              <form
                onSubmit={(e) => { e.preventDefault(); enviar(input); }}
                className="flex items-end gap-2 border-t border-border p-3"
              >
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(input); } }}
                  rows={2}
                  maxLength={2000}
                  placeholder="Escreva sua dúvida (pode colar a matrícula)"
                  className="flex-1 resize-none rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                <button type="submit" disabled={busy || !input.trim()} aria-label="Enviar"
                  className="rounded-md bg-primary p-2 text-primary-foreground disabled:opacity-50">
                  <Send className="h-4 w-4" />
                </button>
              </form>
            </>
          )}
        </div>
      )}
    </>
  );
}
