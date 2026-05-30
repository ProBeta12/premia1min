import express from 'express';
import sqlite3 from 'sqlite3';

const app = express();
const PORT = 3000;

app.use(express.json());

const db = new sqlite3.Database('./sorteio.db');

db.run(`
  CREATE TABLE IF NOT EXISTS participantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    comprado INTEGER DEFAULT 1
  )
`);

// Array para guardar as conexões ativas do painel visual
let conexoesPainel = [];

// Rota SSE: Mantém uma conexão aberta com o navegador do painel
app.get('/painel-logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  conexoesPainel.push(res);
  
  req.on('close', () => {
    conexoesPainel = conexoesPainel.filter(p => p !== res);
  });
});

// Rota POST: Modificada para avisar o painel visual assim que o dado chega
app.post('/comprar-ticket', (req, res) => {
  const { nome } = req.body;

  if (!nome || nome.trim() === "") {
    return res.status(400).send('Nome inválido.');
  }

  const query = 'INSERT INTO participantes (nome) VALUES (?)';
  
  db.run(query, [nome], function(err) {
    if (err) return res.status(500).json({ erro: err.message });

    const novoParticipante = {
      nome: nome,
      ticket: this.lastID,
      horario: new Date().toLocaleTimeString()
    };

    // Alerta todas as telas visuais abertas que uma requisição acabou de ser processada
    conexoesPainel.forEach(painel => {
      painel.write(`data: ${JSON.stringify(novoParticipante)}\n\n`);
    });

    res.status(201).json({ mensagem: 'Sucesso!', dados: novoParticipante });
  });
});

// Rota GET: Serve a tela visual (HTML) diretamente no navegador
app.get('/painel', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Painel do Sorteio em Tempo Real</title>
      <style>
        body { font-family: sans-serif; background: #121214; color: #e1e1e6; padding: 20px; }
        h1 { color: #04d361; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .box { background: #202024; padding: 20px; border-radius: 8px; border: 1px solid #323238; }
        .log-item { background: #29292e; padding: 10px; margin-bottom: 8px; border-left: 4px solid #04d361; border-radius: 4px; animation: blink 0.5s ease-out; }
        @keyframes blink { from { background: #04d361; } to { background: #29292e; } }
      </style>
    </head>
    <body>
      <h1>📊 Monitor de Requisições do Sorteio</h1>
      <p>Abaixo você vê as requisições sendo processadas pelo SQLite em tempo real:</p>
      
      <div class="grid">
        <div class="box">
          <h2>📥 Últimas Requisições Chegando</h2>
          <div id="logs"><em>Aguardando cliques frenéticos...</em></div>
        </div>
      </div>

      <script>
        // Se conecta com o servidor para receber atualizações automáticas
        const evtSource = new EventSource('/painel-logs');
        const logsDiv = document.getElementById('logs');

        evtSource.onmessage = function(event) {
          const dados = JSON.parse(event.data);
          
          if(logsDiv.innerHTML.includes('Aguardando')) logsDiv.innerHTML = '';

          // Cria o elemento visual do log na tela
          const novoLog = document.createElement('div');
          novoLog.className = 'log-item';
          novoLog.innerHTML = '<strong>[' + dados.horario + ']</strong> POST recebido! Usuário <strong>' + dados.nome + '</strong> ganhou o Ticket #<strong>' + dados.ticket + '</strong>';
          
          // Coloca sempre no topo da lista
          logsDiv.insertBefore(novoLog, logsDiv.firstChild);
        };
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
