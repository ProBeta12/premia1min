import express from 'express';
import fs from 'fs';
import { listaSorteio } from './data.js';

const app = express();
const PORT = 3000;

app.use(express.json());

// Rota GET: Para o seu front-end puxar e mostrar quem já está participando
app.get('/participantes', (req, res) => {
  res.json(listaSorteio);
});

// Rota POST: Recebe o nome do front-end e gera o ticket premiado/comprado
app.post('/comprar-ticket', (req, res) => {
  const { nome } = req.body;

  // Validação para garantir que o front-end enviou o nome
  if (!nome || nome.trim() === "") {
    return res.status(400).send('Por favor, informe um nome válido para o sorteio.');
  }

  // Lógica do Ticket: O número do ticket será a posição dele na lista (começando em 1)
  const numeroTicket = listaSorteio.length + 1;

  // Cria o novo participante com o formato que você pediu
  const novoParticipante = {
    nome: nome,
    ticket: numeroTicket,
    comprado: true
  };

  // Adiciona na lista
  listaSorteio.push(novoParticipante);

  // Reescreve o arquivo data.js mantendo a estrutura de exportação
  const conteudoDoArquivo = `export const listaSorteio = ${JSON.stringify(listaSorteio, null, 2)};`;
  fs.writeFileSync('./data.js', conteudoDoArquivo, 'utf-8');

  // Retorna para o front-end o sucesso e o número do ticket gerado
  res.status(201).json({
    mensagem: 'Ticket gerado e salvo com sucesso!',
    dados: novoParticipante
  });
});

app.listen(PORT, () => {
  console.log(`Servidor do Sorteio rodando na porta ${PORT}`);
});
