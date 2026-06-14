import express from 'express';
import sqlite3 from 'sqlite3';
import crypto from 'crypto';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const app = express();
const PORT = 4000;

// Configuração necessária para usar __dirname com ES Modules (import)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

const db = new sqlite3.Database(':memory:');

// Banco de dados com auditoria financeira completa
db.run(`
  CREATE TABLE IF NOT EXISTS participantes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    nome TEXT NOT NULL,
    chave_secreta TEXT,
    banco_validador TEXT,
    tempo_fila_segundos INTEGER,
    valor_original REAL,
    porcentagem_banco REAL,
    valor_liquido REAL,
    status TEXT NOT NULL
  )
`);

// Configuração estática dos 4 bancos validadores
const BANCOS = {
  Nubank: { nome: 'Nubank', taxa: 0.10, velocidade: 1000, ativo: true },
  Inter: { nome: 'Inter', taxa: 0.20, velocidade: 500, ativo: false, gatilhoAtivar: 10 },
  Itau: { nome: 'Itaú', taxa: 0.30, velocidade: 500, ativo: false, gatilhoAtivar: 20 },
  SolanaPay: { nome: 'SolanaPay', taxa: 0.80, velocidade: 0, ativo: false, gatilhoAtivar: 60 }
};

let filaEspera = [];
let conexoesPainel = [];
let sorteioAtivo = false;
let tempoRestante = 0;
let intervaloCronometro = null;
let faturamentoLiquido = 0;

let ganhadorAtual = null;
let tempoConfirmacaoGanhador = 0;
let intervaloGanhador = null;

// Controladores de loop ativo de cada banco
const rotinasBancos = { Nubank: false, Inter: false, Itau: false };

// Calcula o tempo estimado de espera baseado nas taxas de processamento dos bancos atualmente ativos
function calcularTempoEsperaFila() {
  let requisicoesPorSegundo = 0;
  if (BANCOS.Nubank.ativo) requisicoesPorSegundo += (1000 / BANCOS.Nubank.velocidade);
  if (BANCOS.Inter.ativo) requisicoesPorSegundo += (1000 / BANCOS.Inter.velocidade);
  if (BANCOS.Itau.ativo) requisicoesPorSegundo += (1000 / BANCOS.Itau.velocidade);
  
  if (requisicoesPorSegundo === 0 || filaEspera.length === 0) return 0;
  return Math.round(filaEspera.length / requisicoesPorSegundo);
}

// Algoritmo de Roteamento Dinâmico com Estratégia de Drenagem Total (Porteira Aberta)
function gerenciarAlgoritmoRoteamento() {
  const tempoEsperaAtual = calcularTempoEsperaFila();

  // 1. Regras de Ativação por Gargalo
  if (!BANCOS.Inter.ativo && tempoEsperaAtual >= BANCOS.Inter.gatilhoAtivar) {
    BANCOS.Inter.ativo = true;
    iniciarLoopBanco('Inter');
  }
  if (!BANCOS.Itau.ativo && tempoEsperaAtual >= BANCOS.Itau.gatilhoAtivar) {
    BANCOS.Itau.ativo = true;
    iniciarLoopBanco('Itau');
  }
  if (!BANCOS.SolanaPay.ativo && tempoEsperaAtual > BANCOS.SolanaPay.gatilhoAtivar) {
    BANCOS.SolanaPay.ativo = true;
  }

  // 2. Regra de Desativação Estratégica: Só desliga se a fila zerar completamente
  if (filaEspera.length === 0) {
    BANCOS.Inter.ativo = false;
    BANCOS.Itau.ativo = false;
    BANCOS.SolanaPay.ativo = false;
  }

  // 3. Processamento de Tempo Máximo (SolanaPay ativa drena tudo na velocidade da rede instantaneamente)
  if (BANCOS.SolanaPay.ativo && filaEspera.length > 0) {
    while (filaEspera.length > 0 && BANCOS.SolanaPay.ativo) {
      const pedido = filaEspera.shift();
      if (pedido) processarTransacao(pedido, BANCOS.SolanaPay);
    }
    // Após drenar tudo, reseta os bancos adicionais para o estado falso
    BANCOS.Inter.ativo = false;
    BANCOS.Itau.ativo = false;
    BANCOS.SolanaPay.ativo = false;
  }

  // Envia atualização de status para o dashboard
  enviarParaPainel({
    tipo: 'status-bancos',
    bancos: BANCOS,
    tempoEspera: calcularTempoEsperaFila()
  });
}

// Inicia loops assíncronos individuais para os validadores baseados em timeout
function iniciarLoopBanco(chaveBanco) {
  if (rotinasBancos[chaveBanco]) return;
  rotinasBancos[chaveBanco] = true;

  const rodar = () => {
    if (!sorteioAtivo && filaEspera.length === 0) {
      rotinasBancos[chaveBanco] = false;
      return;
    }
    if (!BANCOS[chaveBanco].ativo && chaveBanco !== 'Nubank') {
      rotinasBancos[chaveBanco] = false;
      return;
    }

    if (filaEspera.length > 0) {
      const pedido = filaEspera.shift();
      if (pedido) {
        processarTransacao(pedido, BANCOS[chaveBanco]);
      }
      setTimeout(rodar, BANCOS[chaveBanco].velocidade);
    } else {
      setTimeout(rodar, 150);
    }
  };
  rodar();
}

function processarTransacao(pedido, banco) {
  const chaveGerada = crypto.randomBytes(3).toString('hex');
  const tempoGastoNaFila = Math.round((Date.now() - pedido.timestampEntrada) / 1000);

  const valorOriginal = 2.00;
  const taxaBanco = valorOriginal * banco.taxa;
  const valorLiquido = valorOriginal - taxaBanco;

  db.run(
    `INSERT INTO participantes 
      (nome, chave_secreta, banco_validador, tempo_fila_segundos, valor_original, porcentagem_banco, valor_liquido, status) 
      VALUES (?, ?, ?, ?, ?, ?, ?, 'APROVADO')`, 
    [pedido.nome, chaveGerada, banco.nome, tempoGastoNaFila, valorOriginal, taxaBanco, valorLiquido], 
    function(err) {
      if (!err) {
        faturamentoLiquido += valorLiquido;
        
        const dadosTicket = {
          ticket: this.lastID,
          nome: pedido.nome,
          banco: banco.nome,
          taxaCobranca: taxaBanco,
          chaveSecreta: chaveGerada,
          tempoFila: tempoGastoNaFila,
          lucroLiquido: faturamentoLiquido
        };

        enviarParaPainel({
          tipo: 'requisicao-processada',
          ...dadosTicket,
          filaRestante: filaEspera.length,
          tempoEspera: calcularTempoEsperaFila()
        });

        pedido.callbackSucesso(dadosTicket);
      } else {
        pedido.callbackErro(err.message);
      }
      gerenciarAlgoritmoRoteamento();
    }
  );
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

// Rota de Entrada / Compra de Tickets
app.post('/comprar-ticket', (req, res) => {
  const { nome } = req.body;

  if (!sorteioAtivo || tempoRestante <= 0) {
    return res.status(400).json({ erro: 'FlashSort inativo ou tempo do lote esgotado!' });
  }
  if (!nome || nome.trim() === "") {
    return res.status(400).json({ erro: 'Nome inválido.' });
  }

  filaEspera.push({
    nome: nome,
    timestampEntrada: Date.now(),
    callbackSucesso: (dados) => {
      res.status(201).json({ 
        status: "Aprovado", 
        ticket: dados.ticket, 
        validador: dados.banco,
        chave_secreta: dados.chaveSecreta 
      });
    },
    callbackErro: (erro) => {
      res.status(500).json({ erro });
    }
  });

  enviarParaPainel({ tipo: 'nova-requisicao', nome, filaRestante: filaEspera.length, tempoEspera: calcularTempoEsperaFila() });
  gerenciarAlgoritmoRoteamento();
});

// Endpoint Analítico para os Gráficos externos consumirem
app.get('/painel/dados-analise', (req, res) => {
  db.all('SELECT * FROM participantes', [], (err, rows) => {
    if (err) return res.status(500).json({ erro: err.message });
    res.json(rows);
  });
});

// Iniciar Lote de 1 minuto
app.post('/painel/iniciar', (req, res) => {
  if (sorteioAtivo) return res.status(400).send('FlashSort já está rodando.');
  sorteioAtivo = true;
  tempoRestante = 60;
  filaEspera = [];
  
  BANCOS.Inter.ativo = false;
  BANCOS.Itau.ativo = false;
  BANCOS.SolanaPay.ativo = false;

  iniciarLoopBanco('Nubank');

  intervaloCronometro = setInterval(() => {
    tempoRestante--;
    enviarParaPainel({ tipo: 'tempo', tempo: tempoRestante, filaRestante: filaEspera.length, tempoEspera: calcularTempoEsperaFila() });

    if (tempoRestante <= 0) {
      clearInterval(intervaloCronometro);
      sorteioAtivo = false;
      
      const momentoRejeicao = Date.now();
      let totalSalvoRejeitados = 0;

      filaEspera.forEach(pedido => {
        const tempoEsperaFila = Math.round((momentoRejeicao - pedido.timestampEntrada) / 1000);
        db.run(
          `INSERT INTO participantes 
            (nome, chave_secreta, banco_validador, tempo_fila_segundos, valor_original, porcentagem_banco, valor_liquido, status) 
            VALUES (?, NULL, 'Descartado', ?, 2.00, 0.00, 0.00, 'REJEITADO')`,
          [pedido.nome, tempoEsperaFila]
        );
        pedido.callbackErro('Lote encerrado. Transação descartada sem cobrança.');
        totalSalvoRejeitados++;
      });

      enviarParaPainel({ 
        tipo: 'fim-tempo', 
        mensagem: `Tempo ESGOTADO! ${totalSalvoRejeitados} requisições pendentes foram arquivadas como REJEITADAS.`,
        filaRestante: 0
      });
      filaEspera = []; 
    }
  }, 1000);
  res.sendStatus(200);
});

// Rotas auxiliares de sorteio e premiação
app.get('/painel/sortear', (req, res) => {
  if (intervaloGanhador) clearInterval(intervaloGanhador);
  db.all("SELECT * FROM participantes WHERE status = 'APROVADO'", [], (err, rows) => {
    if (err || rows.length === 0) return res.status(400).json({ erro: 'Sem transações aprovadas disponíveis.' });
    ganhadorAtual = rows[Math.floor(Math.random() * rows.length)];
    tempoConfirmacaoGanhador = 60;
    enviarParaPainel({ tipo: 'ganhador-sorteado', ticket: ganhadorAtual.id, nome: ganhadorAtual.nome, banco: ganhadorAtual.banco_validador, tempo: tempoConfirmacaoGanhador });
    
    intervaloGanhador = setInterval(() => {
      tempoConfirmacaoGanhador--;
      enviarParaPainel({ tipo: 'tempo-ganhador', tempo: tempoConfirmacaoGanhador });
      if (tempoConfirmacaoGanhador <= 0) {
        clearInterval(intervaloGanhador);
        enviarParaPainel({ tipo: 'ganhador-expirou', mensagem: `O Ticket #${ganhadorAtual.id} expirou.` });
        ganhadorAtual = null;
      }
    }, 1000);
    res.json({ ticket: ganhadorAtual.id, nome: ganhadorAtual.nome });
  });
});

app.post('/confirmar-premio', (req, res) => {
  const { ticket, chave } = req.body;
  if (!ganhadorAtual) return res.status(400).json({ erro: 'Sem sorteio ativo aguardando validação.' });
  if (Number(ticket) === ganhadorAtual.id && chave === ganhadorAtual.chave_secreta) {
    clearInterval(intervaloGanhador);
    enviarParaPainel({ tipo: 'ganhador-confirmado', nome: ganhadorAtual.nome, ticket: ganhadorAtual.id });
    ganhadorAtual = null;
    return res.json({ sucesso: true });
  }
  return res.status(400).json({ erro: 'Dados de validação inconsistentes.' });
});

// Rota de Limpar Tudo
app.post('/painel/limpar', (req, res) => {
  clearInterval(intervaloCronometro);
  clearInterval(intervaloGanhador);
  sorteioAtivo = false;
  tempoRestante = 0;
  filaEspera = [];
  faturamentoLiquido = 0;
  ganhadorAtual = null;

  BANCOS.Inter.ativo = false;
  BANCOS.Itau.ativo = false;
  BANCOS.SolanaPay.ativo = false;
  rotinasBancos.Inter = false;
  rotinasBancos.Itau = false;

  db.run('DELETE FROM participantes', () => {
    enviarParaPainel({ tipo: 'limpar-tela' });
    res.sendStatus(200);
  });
});

// Dashboard Administrativo - Agora servindo o arquivo estático
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/performance', (req, res) => {
  res.sendFile(path.join(__dirname, 'performance.html'));
});

app.listen(PORT, () => console.log(`[FlashSort] Cluster rodando com Drenagem Total na porta ${PORT}`));