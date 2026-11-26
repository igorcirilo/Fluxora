# Fluxora — pacote de desenvolvimento remoto

Repositório: https://github.com/igorcirilo/Fluxora

## Comece pelo celular
1. Anexe este pacote ao agente programador com acesso ao GitHub e, se disponível, Vercel.
2. Peça que leia `superprompt-app-mei.md` integralmente e execute a diretriz de desenvolvimento remoto.
3. Revise o PR e o preview pelo navegador do celular. Nenhuma instalação local é necessária.
4. Aprove alterações somente após verificar testes e limitações.

## Conteúdo
- `documentacao-app-mei.pdf`: referência executiva original (anterior à diretriz remota).
- `documentacao-app-mei.md`: documentação técnica atualizada.
- `superprompt-app-mei.md`: instruções atualizadas para o agente.
- `app-mei-base.zip`: protótipo Python/SQLite, testes e schema; referência para migração Next.js.

A Vercel é temporária, para demonstração com dados fictícios. Artifacts são alternativa de visualização. A infraestrutura definitiva continua prevista em VPS/Coolify. Não há deploy realizado nesta atualização; o agente deverá obter acesso autorizado e executar as etapas. O PDF original foi preservado; em caso de conflito, prevalecem as instruções atualizadas em Markdown.

## Diretriz prioritária — Fluxora, desenvolvimento 100% remoto pelo celular
O nome do produto é Fluxora. Repositório obrigatório: https://github.com/igorcirilo/Fluxora . Esta diretriz prevalece sobre instruções anteriores de execução local e publicação: o proprietário acompanha tudo pelo celular. Não exija terminal local, instalação de Python, Node, Docker ou download de dependências pelo proprietário.

1. Verifique acesso autorizado ao GitHub e inspecione a árvore, branches, histórico e configurações existentes. Não presuma que o repositório está vazio. Preserve trabalho existente. Crie branch `feat/fluxora-bootstrap` (ou nome equivalente sem colisão), importe a documentação em `/docs`, implemente e faça commits pequenos. Abra PR com descrição, testes e limitações. Não faça force push nem sobrescreva a branch principal. Solicite autorização/conexão se faltar acesso.
2. Use ambiente cloud do agente ou CI GitHub Actions para executar comandos. Priorize Next.js + TypeScript, Tailwind e arquitetura modular descrita no documento; o protótipo Python/SQLite é referência de regras e testes, não runtime da Vercel. Fixe dependências e lockfile; configure scripts lint, typecheck, test e build. Execute-os e reporte resultados reais. Não use SQLite persistente em funções serverless.
3. Entregue primeiro uma demonstração responsiva e navegável, com dashboard, vendas/PDV, produtos, clientes, financeiro, Meu MEI, fiscal e configurações. Implemente o motor de caixa e limite MEI com testes; use dados fictícios claramente identificados. Se persistência for necessária, use PostgreSQL Neon em ambiente de teste, somente com autorização e credenciais disponíveis. Sem banco, use modo demo isolado com dados locais não sensíveis, explicitando suas limitações. Não simule emissão fiscal ou pagamento real como sucesso.
4. Conecte o repositório ao projeto Vercel autorizado e gere um Preview Deployment da branch/PR. Use Next.js compatível com Vercel. Não crie serviços pagos sem autorização; confirme limites e elegibilidade do plano (Hobby é destinado a uso pessoal não comercial). Se o preview gratuito não for permitido, use Artifacts ou alternativa aprovada. Não configure domínio de produção, não publique dados reais nem faça deploy comercial. Configure segredos somente no ambiente autorizado, nunca no Git. Proteja previews que contenham dados privados; para demo pública, use exclusivamente dados fictícios e nenhum segredo exposto.
5. Verifique build e URL real do preview, navegação mobile (larguras 375/390/430 px), desktop, cálculos, formulários e estados vazios. Teste o isolamento entre tenants quando houver backend real. Entregue link clicável do PR, commit, preview Vercel e relatório de testes. Não invente URLs nem declare deploy concluído sem confirmação.
6. Se o agente oferecer Artifacts/preview interativo, pode entregar uma versão navegável do design como alternativa ou complemento ao preview Vercel. Identifique claramente se é protótipo sem backend. O Artifact não substitui código versionado no GitHub; se não houver acesso ao repositório, informe o bloqueio e peça conexão, sem alegar publicação.
7. Em cada iteração, mantenha a mesma base, atualize documentação e testes, faça commits e disponibilize novo preview. O proprietário deve conseguir revisar pelo celular e aprovar o PR. Não faça merge sem autorização. Para produção futura, preserve Docker/Coolify/PostgreSQL e migrações portáveis; Vercel é apenas ambiente temporário de visualização. Não execute emissão fiscal real nem cobranças sem autorização e homologação.

### Entrega obrigatória ao final de cada etapa
- Link real do GitHub/PR e hash do commit.
- Link real do preview Vercel ou Artifact interativo, quando disponível.
- Funcionalidades implementadas, resultados de testes, limitações e custos previstos.
- Próxima etapa sugerida e decisões que dependem de aprovação.
