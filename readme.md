Premia1min
===========

Breve descrição
---------------
Projeto de sorteios relâmpago (flash draws) com duas abordagens: uma versão estática simples e uma versão dinâmica com gerenciamento de validadores e painel em tempo real.

Iniciar cada servidor
---------------------
Para iniciar a versão que desejar execute `node server.js` dentro da pasta correspondente:

```bash
# Terminal A: servidor estático
cd estatica
node server.js

# Terminal B: servidor dinâmico
cd dinamico
node server.js
```

Arquitetura de validadores
--------------------------
- Estático: sorteio relâmpago com um único validador de compra (processador único). Simples e adequado para testes ou demonstrações.
- Dinâmico: sorteio relâmpago com 4 validadores simultâneos. Os validadores são realocados dinamicamente com base no tempo de espera na fila para equilibrar processamento e reduzir latência.

Páginas / rotas servidas
-----------------------
Cada servidor serve as mesmas páginas principais (painel e páginas de cliente):

- `index.html` — painel (painel de operações/visualização em tempo real)
- `comprar.html` — página onde o usuário compra o bilhete
- `autocomprar.html` — página usada para testes/fluxos automatizados (auto-compra)
- `performance.html` — página para coletar métricas e exibir gráficos


- Configurar encaminhamento de porta no roteador (port forwarding) para a porta do servidor.

GitHub Codespaces
-----------------
No Codespaces, abra o painel `Ports` ou `Forwarded Ports` e verifique a porta em que o servidor está rodando.

- Execute o servidor normalmente: `node server.js`
- O Codespaces detecta a porta e mostra um link de visualização
- Clique em `Open in Browser` ou copie a URL gerada

A URL do Codespaces normalmente fica no formato:

`https://4000-<user>-<repo>.<region>.githubpreview.dev`

ou similar, dependendo da instância do Codespaces.

URLs esperadas
--------------
Supondo que o servidor rode em `https://4000-<user>-<repo>.<region>.githubpreview.dev`:

- Estática:
  - `https://....githubpreview.dev/estatica/` -> painel estático
  - `https://....githubpreview.dev/comprar` -> comprar
  - `https://....githubpreview.dev/autocomprar` -> autocomprar (teste)
  - `https://....githubpreview.dev/performance` -> performance

- Dinâmica:
  - `https://....githubpreview.dev/` -> painel dinâmico
  - `https://....githubpreview.dev/comprar` -> comprar
  - `https://....githubpreview.dev/autocomprar` -> autocomprar (teste)
  - `https://....githubpreview.dev/performance` -> performance

