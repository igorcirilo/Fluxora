# Registro de decisões

| Data | Decisão | Situação |
|---|---|---|
| 27/11/2026 | Infraestrutura temporária: Vercel (Hobby) + Neon PostgreSQL em São Paulo (`aws-sa-east-1`), funções em `gru1`. Produção definitiva continua prevista em VPS com Docker/Coolify. | Em vigor |
| 27/11/2026 | Foco dos pilotos: **comércio** primeiro, estado **SP**; contador previsto: **Mônica** (a confirmar). | Em vigor |
| 27/11/2026 | Demo pública: proteção da Vercel desligada; somente dados fictícios na demo, contas reais isoladas por empresa. | Em vigor |
| 27/11/2026 | **Emissor de NFC-e: Focus NFe** (plano Retail como referência; Engine API como alternativa de custo zero). Integração via `FiscalProvider`, primeiro em homologação. | **Decidido, implementação no fim do roadmap** — depende da revisão do contador (roteiro "Roteiro NFC-e SP") e de cotação atualizada |
| 27/11/2026 | Troca da branch de produção da Vercel para `main` | Postergada (sem impacto: as duas branches são atualizadas juntas) |
| 28/11/2026 | **Importação do XML da NF-e de compra** com leitor próprio (`fast-xml-parser`, sem DTD/entidades, limite de 1 MB). O servidor relê o XML; valores, vencimentos e chave vêm do documento. Pagamento segue as duplicatas da nota; a chave de acesso impede importação repetida. Assinatura digital não validada (conferência na SEFAZ continua com o usuário/contador). | Em vigor |
