
import express from 'express';
import sqlite3 from 'sqlite3';
import crypto from 'crypto';
import cors from 'cors'; // <-- Adicione esta linha

const app = express();
const PORT = 3000;

app.use(cors()); // <-- Adicione esta linha logo acima do app.use(express.json())
app.use(express.json());

const db = new sqlite3.Database(':memory:');

db.run(`
  CREATE TABLE IF NOT EXISTS participantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    chave_secreta TEXT NOT NULL
  )
`);

// Variáveis de controle
let filaEspera = [];
let conexoesPainel = [];
let sorteioAtivo = false;
let tempoRestante = 0;
let intervaloCronometro = null;
let atendenteTrabalhando = false;
let totalArrecadado = 0;

let ganhadorAtual = null;
let tempoConfirmacaoGanhador = 0;
let intervaloGanhador = null;

// Função do Atendente: Processa 1 pessoa da fila a cada 1 segundo
function iniciarAtendente() {
  if (atendenteTrabalhando) return;
  atendenteTrabalhando = true;

  const processarProximo = () => {
    if (!sorteioAtivo && filaEspera.length === 0) {
      atendenteTrabalhando = false;
      enviarParaPainel({ tipo: 'status-atendente', mensagem: 'Atendente descansando...' });
      return;
    }

    if (filaEspera.length > 0) {
      // Pega o primeiro item da fila (que agora contém o nome e a função de callback)
      const pedido = filaEspera.shift(); 
      const chaveGerada = crypto.randomBytes(3).toString('hex');

      db.run('INSERT INTO participantes (nome, chave_secreta) VALUES (?, ?)', [pedido.nome, chaveGerada], function(err) {
        if (!err) {
          totalArrecadado += 2;
          
          // Dados do ticket gerado
          const dadosTicket = {
            ticket: this.lastID,
            nome: pedido.nome,
            chaveSecreta: chaveGerada,
            horario: new Date().toLocaleTimeString(),
            faturamento: totalArrecadado
          };

          // 1. Avisa o painel visual
          enviarParaPainel({
            tipo: 'requisicao-processada',
            ...dadosTicket,
            filaRestante: filaEspera.length
          });

          // 2. Responde o Postman do usuário avisando que foi EFETUADA!
          pedido.callbackSucesso(dadosTicket);
        } else {
          pedido.callbackErro(err.message);
        }
        
        // Atendente espera 1 segundo antes de ir para o próximo
        setTimeout(processarProximo, 1000);
      });
    } else {
      setTimeout(processarProximo, 200);
    }
  };
  processarProximo();
}

function enviarParaPainel(dados) {
  conexoesPainel.forEach(p => p.write(`data: ${JSON.stringify(dados)}\n\n`));
}

app.get('/painel-logs', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  conexoesPainel.push(res);
  req.on('close', () => conexoesPainel = conexoesPainel.filter(p => p !== res));
});

// 1. Rota de Compra Atualizada: Ela espera o atendente validar para responder
app.post('/comprar-ticket', (req, res) => {
  const { nome } = req.body;

  if (!sorteioAtivo || tempoRestante <= 0) {
    return res.status(400).json({ erro: 'O sorteio não está ativo ou o tempo de 1 minuto já acabou!' });
  }
  if (!nome || nome.trim() === "") {
    return res.status(400).json({ erro: 'Nome inválido.' });
  }

  // Coloca o nome na fila junto com as funções de resposta (resolve/reject)
  filaEspera.push({
    nome: nome,
    callbackSucesso: (dados) => {
      res.status(201).json({
        status: "Sucesso",
        mensagem: "Compra efetuada com sucesso!",
        ticket: dados.ticket,
        chave_secreta: dados.chaveSecreta
      });
    },
    callbackErro: (erro) => {
      res.status(500).json({ erro });
    }
  });

  enviarParaPainel({ tipo: 'nova-requisicao', nome, filaRestante: filaEspera.length });
});

// 2. Iniciar Sorteio
app.post('/painel/iniciar', (req, res) => {
  if (sorteioAtivo) return res.status(400).send('Sorteio já está rodando.');
  sorteioAtivo = true;
  tempoRestante = 60;
  filaEspera = [];
  iniciarAtendente();

  intervaloCronometro = setInterval(() => {
    tempoRestante--;
    enviarParaPainel({ tipo: 'tempo', tempo: tempoRestante });

    if (tempoRestante <= 0) {
      clearInterval(intervaloCronometro);
      sorteioAtivo = false;
      
      // Responde com erro para todos que ficaram presos na fila e foram descartados
      filaEspera.forEach(pedido => {
        pedido.callbackErro('Descartado! O tempo de 1 minuto do sorteio acabou antes do atendente chegar em você.');
      });

      const descartados = filaEspera.length;
      filaEspera = []; 
      enviarParaPainel({ 
        tipo: 'fim-tempo', 
        mensagem: `Tempo ESGOTADO! ${descartados} pessoas foram descartadas por falta de tempo.`,
        filaRestante: 0
      });
    }
  }, 1000);
  res.sendStatus(200);
});

// 3. Sortear Vencedor
app.get('/painel/sortear', (req, res) => {
  if (intervaloGanhador) clearInterval(intervaloGanhador);

  db.all('SELECT * FROM participantes', [], (err, rows) => {
    if (err || rows.length === 0) {
      return res.status(400).json({ erro: 'Nenhum participante foi atendido a tempo para ser sorteado.' });
    }
    
    ganhadorAtual = rows[Math.floor(Math.random() * rows.length)];
    tempoConfirmacaoGanhador = 60;

    enviarParaPainel({ 
      tipo: 'ganhador-sorteado', 
      ticket: ganhadorAtual.id, 
      nome: ganhadorAtual.nome,
      tempo: tempoConfirmacaoGanhador
    });

    intervaloGanhador = setInterval(() => {
      tempoConfirmacaoGanhador--;
      enviarParaPainel({ tipo: 'tempo-ganhador', tempo: tempoConfirmacaoGanhador });

      if (tempoConfirmacaoGanhador <= 0) {
        clearInterval(intervaloGanhador);
        enviarParaPainel({ tipo: 'ganhador-expirou', mensagem: `O Ticket #${ganhadorAtual.id} (${ganhadorAtual.nome}) não validou a tempo!` });
        ganhadorAtual = null;
      }
    }, 1000);

    res.json({ ticket: ganhadorAtual.id, nome: ganhadorAtual.nome });
  });
});

// 4. Confirmar Prêmio
app.post('/confirmar-premio', (req, res) => {
  const { ticket, chave } = req.body;

  if (!ganhadorAtual || tempoConfirmacaoGanhador <= 0) {
    return res.status(400).json({ erro: 'Não há sorteio aguardando confirmação ou o tempo expirou.' });
  }

  if (Number(ticket) === ganhadorAtual.id && chave === ganhadorAtual.chave_secreta) {
    clearInterval(intervaloGanhador);
    enviarParaPainel({ tipo: 'ganhador-confirmado', nome: ganhadorAtual.nome, ticket: ganhadorAtual.id });
    ganhadorAtual = null;
    return res.json({ sucesso: true, mensagem: 'PARABÉNS! Prêmio confirmado! 🏆' });
  } else {
    return res.status(400).json({ erro: 'Ticket ou Chave Secreta incorretos!' });
  }
});

// 5. Limpar Tudo
app.post('/painel/limpar', (req, res) => {
  clearInterval(intervaloCronometro);
  clearInterval(intervaloGanhador);
  sorteioAtivo = false;
  tempoRestante = 0;
  tempoConfirmacaoGanhador = 0;
  filaEspera = [];
  totalArrecadado = 0;
  ganhadorAtual = null;
  db.run('DELETE FROM participantes', () => {
    enviarParaPainel({ tipo: 'limpar-tela' });
    res.sendStatus(200);
  });
});

// 6. Painel HTML
app.get('/painel', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="pt-BR">
    <head>
      <meta charset="UTF-8">
      <title>Simulador de Sorteio com Atendente</title>
      <style>
        body { font-family: system-ui, sans-serif; background: #121214; color: #e1e1e6; padding: 20px; max-width: 1000px; margin: 0 auto; }
        h1 { color: #04d361; text-align: center; margin-bottom: 5px; }
        .stats-topo { display: flex; gap: 20px; justify-content: center; margin: 15px 0; }
        .stat-card { background: #202024; border: 1px solid #323238; padding: 10px 25px; border-radius: 8px; text-align: center; min-width: 150px; }
        .stat-card h4 { margin: 0; color: #a8a8b3; font-size: 0.9rem; text-transform: uppercase; }
        .stat-card p { margin: 5px 0 0 0; font-size: 2rem; font-weight: bold; }
        #tempo { color: #ff9000; }
        #faturamento { color: #04d361; }
        .status-atendente { background: #29292e; padding: 10px; border-radius: 5px; text-align: center; font-style: italic; color: #a8a8b3; margin-bottom: 20px; }
        .controles { display: flex; gap: 15px; justify-content: center; margin-bottom: 30px; }
        button { background: #04d361; color: #fff; border: none; padding: 12px 24px; font-size: 1rem; border-radius: 6px; cursor: pointer; font-weight: bold; transition: background 0.2s; }
        button:hover { background: #02a74b; }
        button.btn-sortear { background: #ff9000; }
        button.btn-sortear:hover { background: #e68000; }
        button.btn-limpar { background: #c53030; }
        button.btn-limpar:hover { background: #a52525; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .box { background: #202024; padding: 20px; border-radius: 8px; border: 1px solid #323238; height: 400px; overflow-y: auto; }
        .log-item { background: #29292e; padding: 12px; margin-bottom: 8px; border-left: 4px solid #04d361; border-radius: 4px; font-size: 0.95rem; }
        .log-item.fila { border-left-color: #ff9000; }
        .log-item.descartado { border-left-color: #c53030; background: #3a1e1e; color: #f5a6a6; }
        .vencedor-box { background: #ff9000; color: #121214; padding: 20px; border-radius: 8px; text-align: center; font-size: 1.5rem; font-weight: bold; margin-top: 20px; display: none; }
        .vencedor-box.confirmado { background: #04d361; animation: pulse 1s infinite alternate; }
        .vencedor-box.expirou { background: #c53030; color: #fff; }
        @keyframes pulse { from { transform: scale(1); } to { transform: scale(1.02); } }
      </style>
    </head>
    <body>
      <h1>⏱️ Simulador de Atendimento & Sorteio</h1>
      
      <div class="stats-topo">
        <div class="stat-card">
          <h4>Inscrição</h4>
          <p id="tempo">01:00</p>
        </div>
        <div class="stat-card">
          <h4>Total Ganho</h4>
          <p id="faturamento">R$ 0,00</p>
        </div>
      </div>

      <div class="status-atendente" id="status-atendente">Atendente pronto para começar.</div>

      <div class="controles">
        <button onclick="iniciarSorteio()">Abrir Inscrições (1 Minuto)</button>
        <button class="btn-sortear" onclick="realizarSorteio()">🎉 Sortear Vencedor</button>
        <button class="btn-limpar" onclick="limparTudo()">🗑️ Limpar Tudo / Novo Sorteio</button>
      </div>

      <div class="vencedor-box" id="vencedor-box"></div>

      <div class="grid">
        <div class="box">
          <h3>⏳ Fila de Espera (Aguardando Atendente)</h3>
          <div id="fila-logs">Fila vazia...</div>
        </div>
        <div class="box">
          <h3>✅ Atendidos (Nome | Ticket | Chave Secreta)</h3>
          <div id="atendidos-logs">Ninguém atendido ainda...</div>
        </div>
      </div>

      <script>
        const evtSource = new EventSource('/painel-logs');
        
        evtSource.onmessage = function(event) {
          const dados = JSON.parse(event.data);
          
          if (dados.tipo === 'tempo') {
            document.getElementById('tempo').innerText = '00:' + String(dados.tempo).padStart(2, '0');
            document.getElementById('status-atendente').innerText = '🔥 Inscrições abertas! Atendente validando nomes... Fila: ' + dados.filaRestante;
          }
          
          if (dados.tipo === 'nova-requisicao') {
            const div = document.getElementById('fila-logs');
            if(div.innerHTML.includes('Fila vazia')) div.innerHTML = '';
            div.innerHTML += '<div class="log-item fila">📥 <strong>' + dados.nome + '</strong> entrou na fila!</div>';
          }
          
          if (dados.tipo === 'requisicao-processada') {
            const filaDiv = document.getElementById('fila-logs');
            if(filaDiv.firstChild) filaDiv.removeChild(filaDiv.firstChild);
            if(filaDiv.innerHTML === '') filaDiv.innerHTML = 'Fila vazia...';

            const atendidosDiv = document.getElementById('atendidos-logs');
            if(atendidosDiv.innerHTML.includes('Ninguém atendido')) atendidosDiv.innerHTML = '';
            
            atendidosDiv.innerHTML = '<div class="log-item">⚙️ <strong>' + dados.nome + '</strong> | TICKET #' + dados.ticket + ' | CHAVE: <code style="background:#121214; padding:2px 6px; color:#ff9000; border-radius:4px; font-weight:bold">' + dados.chaveSecreta + '</code></div>' + atendidosDiv.innerHTML;
            
            document.getElementById('faturamento').innerText = 'R$ ' + dados.faturamento.toFixed(2).replace('.', ',');
          }

          if (dados.tipo === 'fim-tempo') {
            document.getElementById('tempo').innerText = '00:00';
            document.getElementById('status-atendente').innerText = dados.mensagem;
            document.getElementById('fila-logs').innerHTML = '<div class="log-item descartado">❌ Fila limpa! Quem sobrou foi descartado.</div>';
          }

          if (dados.tipo === 'ganhador-sorteado') {
            const box = document.getElementById('vencedor-box');
            box.className = 'vencedor-box';
            box.style.display = 'block';
            box.innerHTML = '🔔 Ticket #' + dados.ticket + ' (' + dados.nome + ') foi sorteado! Você tem <span id="tempo-ganhador">60</span>s para validar sua chave!';
          }

          if (dados.tipo === 'tempo-ganhador') {
            const tEl = document.getElementById('tempo-ganhador');
            if(tEl) tEl.innerText = dados.tempo;
          }

          if (dados.tipo === 'ganhador-expirou') {
            const box = document.getElementById('vencedor-box');
            box.className = 'vencedor-box expirou';
            box.innerHTML = '❌ ' + dados.mensagem;
          }

          if (dados.tipo === 'ganhador-confirmado') {
            const box = document.getElementById('vencedor-box');
            box.className = 'vencedor-box confirmado';
            box.innerHTML = '🏆 PARABÉNS! ' + dados.nome + ' (Ticket #' + dados.ticket + ') validou a chave e levou o prêmio! 🏆';
          }

          if (dados.tipo === 'limpar-tela') {
            document.getElementById('tempo').innerText = '01:00';
            document.getElementById('faturamento').innerText = 'R$ 0,00';
            document.getElementById('status-atendente').innerText = 'Atendente pronto para começar.';
            document.getElementById('fila-logs').innerHTML = 'Fila vazia...';
            document.getElementById('atendidos-logs').innerHTML = 'Ninguém atendido ainda...';
            document.getElementById('vencedor-box').style.display = 'none';
          }
        };

        async function iniciarSorteio() {
          await fetch('/painel/iniciar', { method: 'POST' });
        }

        async function realizarSorteio() {
          await fetch('/painel/sortear');
        }

        async function limparTudo() {
          await fetch('/painel/limpar', { method: 'POST' });
        }
      </script>
    </body>
    </html>
  `);
});

app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));
