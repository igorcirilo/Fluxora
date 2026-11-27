# Roteiro para a revisão do contador — NFC-e (piloto SP)

O Fluxora já valida formatos (IE de SP com dígitos verificadores, NCM, CFOP, CSOSN, origem, CEST) e bloqueia produção sem a revisão registrada. **As decisões abaixo são do contador**; nada disso é presumido pelo sistema.

## 1. Obrigatoriedade e regime
- [ ] O MEI do piloto é obrigado a emitir NFC-e nas vendas a consumidor pessoa física em SP, ou a emissão será voluntária?
- [ ] Nas vendas para empresas (CNPJ), qual documento usar (NF-e modelo 55)?
- [ ] CRT a informar na nota (o Fluxora oferece "4 – Simples Nacional · MEI" e "1 – Simples Nacional").
- [ ] O SAT-CF-e ainda é usado por este contribuinte? Há prazo de migração a observar?

## 2. Cadastro na SEFAZ-SP
- [ ] Inscrição estadual ativa (12 dígitos).
- [ ] Credenciamento como emissor de NFC-e concluído.
- [ ] CSC (ID e código) gerado para homologação e, depois, para produção.
- [ ] Certificado digital A1 (e-CNPJ) válido.

## 3. Produtos (por item vendido)
- [ ] NCM (8 dígitos).
- [ ] CFOP padrão de venda ao consumidor dentro do estado.
- [ ] CSOSN (102, 103, 300, 400, 500 ou 900) — atenção a produtos com substituição tributária.
- [ ] Origem da mercadoria (0 a 8).
- [ ] CEST, quando houver ST.

## 4. Operação
- [ ] Série e número inicial.
- [ ] Política de contingência (o Fluxora **não** promete emissão offline sem suporte legal e técnico).
- [ ] Cancelamento: prazo e motivo; devolução de mercadoria.
- [ ] Quem guarda os XMLs e por quanto tempo.

## 5. Registro no sistema
Em **Fiscal → Revisão do contador**, registrar nome e observações. Só depois disso o ambiente de produção pode ser habilitado — e, ainda assim, apenas após testes em homologação com um provedor de emissão contratado.
