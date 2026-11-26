# MEI Gestão — protótipo 0.1
Python 3.13, SQLite, sem pip. Execute `python app.py` e acesse http://localhost:8000 (não 127.0.0.1, a origem padrão é localhost). Cadastre empresa, registre venda e recebimento separadamente, despesa e confira relatórios. Dados persistem em mei.db. Testes: `python -m unittest discover -s tests -v`. Docker: `docker compose up --build`; volume persistente. Backup local consistente: `python backup.py mei.db backup.db`; agende via cron/Task Scheduler e copie cifrado para fora da máquina. Teste restauração em ambiente separado. Coolify: apenas piloto privado, usar Dockerfile e volume /data, APP_ORIGIN=https://seu-dominio, SECURE_COOKIE=1, proxy TLS; não exponha publicamente antes dos requisitos de produção. O servidor padrão Python não é servidor de produção. O schema postgres.sql é ponto de partida não conectado. Consulte docs para limites e próximos passos. Não há emissão fiscal ou Pix real.


## Fluxora — fluxo remoto prioritário
Consulte `docs/SUPERPROMPT.md`. Execução local é apenas referência para CI/agentes; o proprietário revisa pelo celular.
