// Receptor de importação DESLIGADO após a importação da pasta COMPLETOS (23/10/2026).
// A versão usada na importação ficou no histórico da conversa; não religar sem chave nova.
Deno.serve(() => new Response(JSON.stringify({ erro: 'importação desligada' }), { status: 410, headers: { 'Content-Type': 'application/json' } }));
