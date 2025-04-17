// --- Dependências ---
const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const cors = require("cors");
const textToSpeech = require("@google-cloud/text-to-speech");
const { OpenAI } = require("openai");

// Carregar variáveis de ambiente do arquivo .env (para desenvolvimento local)
// A Vercel injetará as variáveis de ambiente configuradas no painel
require("dotenv").config();

// --- Inicialização do Express ---
const app = express();
// Usar a porta definida pelo ambiente (Vercel) ou 3000 para local
const port = process.env.PORT || 3000;

// --- Configuração de CORS ---
// Em produção, restrinja a origem ao seu domínio frontend
const allowedOrigin = process.env.ALLOWED_ORIGIN || "*";
app.use(
  cors({
    origin: allowedOrigin,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept"],
  })
);
console.log(`CORS configurado para permitir origem: ${allowedOrigin}`);

// --- Middlewares ---
app.use((req, res, next) => {
  console.log(`Incoming request for ${req.originalUrl}`);
  next();
});

app.use(bodyParser.json());

// Servir arquivos estáticos da raiz (ajuste se seu HTML/CSS/JS estiver em outra pasta, ex: 'public')
// app.use(express.static("."));
app.use(express.static(path.join(__dirname, ".")));

// Middleware para log de requisições
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// --- Inicialização de Clientes de API ---

// Cliente OpenAI (lê OPENAI_API_KEY do ambiente)
let openai;
try {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Variável de ambiente OPENAI_API_KEY não definida.");
  }
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
  console.log("Cliente OpenAI inicializado com sucesso.");
} catch (error) {
  console.error("Erro ao inicializar cliente OpenAI:", error.message);
  // Definir um cliente fictício ou parar a aplicação pode ser necessário
  openai = null; // Ou lidar com a ausência nas rotas que o usam
}

// Cliente Google Text-to-Speech (via variáveis de ambiente)
let googleTtsClient;
try {
  // Construir o objeto de credenciais a partir das variáveis de ambiente
  const googleCredentials = {
    type: "service_account",
    project_id: process.env.GOOGLE_PROJECT_ID,
    private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
    // A chave privada lida do ambiente deve ter as quebras de linha corretas
    // A Vercel geralmente preserva as quebras de linha ao colar
    private_key: process.env.GOOGLE_PRIVATE_KEY,
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    client_id: process.env.GOOGLE_CLIENT_ID,
    auth_uri: "https://accounts.google.com/o/oauth2/auth",
    token_uri: "https://oauth2.googleapis.com/token",
    auth_provider_x509_cert_url: "https://www.googleapis.com/oauth2/v1/certs",
    client_x509_cert_url: process.env.GOOGLE_CLIENT_X509_CERT_URL,
    universe_domain: "googleapis.com",
  };

  // Verificar se as credenciais essenciais foram carregadas
  if (
    !googleCredentials.project_id ||
    !googleCredentials.client_email ||
    !googleCredentials.private_key
  ) {
    throw new Error(
      "Credenciais essenciais do Google Cloud (PROJECT_ID, CLIENT_EMAIL, PRIVATE_KEY) não encontradas nas variáveis de ambiente."
    );
  }

  // Inicializar o cliente com o objeto de credenciais
  googleTtsClient = new textToSpeech.TextToSpeechClient({
    credentials: googleCredentials,
  });
  console.log(
    "Cliente Google TTS inicializado com sucesso via variáveis de ambiente."
  );
} catch (error) {
  console.error(
    "Erro CRÍTICO ao inicializar cliente Google TTS com credenciais do ambiente:",
    error.message
  );
  // Definir um cliente fictício que lança erro para evitar falhas silenciosas
  googleTtsClient = {
    synthesizeSpeech: async () => {
      console.error("Tentativa de usar cliente TTS não inicializado.");
      throw new Error(
        "Cliente Google Text-to-Speech não inicializado devido a erro de configuração."
      );
    },
  };
}

// --- Gerenciamento de Arquivos de Histórico ---
// Usar /tmp na Vercel para escrita temporária (sistema de arquivos efêmero)
// Ou configurar um armazenamento externo (ex: S3, Google Cloud Storage) para persistência
const textsDir = path.join(
  process.env.VERCEL ? "/tmp" : __dirname,
  "user_texts"
); // Usa /tmp na Vercel
if (!fs.existsSync(textsDir)) {
  try {
    fs.mkdirSync(textsDir, { recursive: true });
    console.log(`Diretório de textos criado em: ${textsDir}`);
  } catch (mkdirError) {
    console.error(
      `Falha ao criar diretório de textos em ${textsDir}:`,
      mkdirError
    );
    // A aplicação pode não funcionar corretamente sem este diretório
  }
} else {
  console.log(`Diretório de textos já existe em: ${textsDir}`);
}

// Função para obter o caminho do arquivo de um usuário específico
function getUserTextFile(userId) {
  // Validar/Sanitizar userId para evitar path traversal
  const safeUserId = path.basename(userId || "default_user");
  return path.join(textsDir, `${safeUserId}.txt`);
}

// --- Rotas da API ---

// Rota Raiz (Verificação)
// app.get("/", (req, res) => {
//   res
//     .status(200)
//     .send(
//       "Servidor Text-to-Speech e Mapa Mental rodando. CORS habilitado para: " +
//         allowedOrigin
//     );
// });

// Rota para converter texto para fala
app.post("/synthesize", async (req, res) => {
  try {
    console.log("Requisição /synthesize recebida:", req.body);
    const { text, theme, gender, userId } = req.body;

    // Validação de Entrada
    if (!text) return res.status(400).json({ error: "Texto é obrigatório" });
    if (!userId)
      return res.status(400).json({ error: "ID do usuário é obrigatório" });

    // Salvamento do Histórico
    const userTextFile = getUserTextFile(userId);
    const timestamp = new Date().toLocaleString("pt-BR");
    const themePart = theme ? `[Tema: ${theme}] ` : "";
    const textEntry = `[${timestamp}] ${themePart}${text}\n\n`;
    try {
      fs.appendFileSync(userTextFile, textEntry);
      console.log(`Texto salvo para ${userId} em ${userTextFile}`);
    } catch (fileError) {
      console.error(
        `Erro ao salvar texto no arquivo ${userTextFile}:`,
        fileError
      );
      // Considerar retornar erro 500 se o salvamento for crítico
    }

    // Geração de Áudio com Google TTS
    const ssmlGender =
      gender && gender.toUpperCase() === "FEMALE" ? "FEMALE" : "MALE";
    const ttsRequest = {
      input: { text: text },
      voice: { languageCode: "pt-BR", ssmlGender: ssmlGender },
      audioConfig: { audioEncoding: "MP3" },
    };

    console.log("Enviando requisição para Google TTS (texto truncado):", {
      text: text.substring(0, 50) + (text.length > 50 ? "..." : ""),
      voice: ttsRequest.voice,
    });

    // Usar o cliente inicializado (googleTtsClient)
    const [ttsResponse] = await googleTtsClient.synthesizeSpeech(ttsRequest);
    const audioContent = ttsResponse.audioContent;

    if (!audioContent || audioContent.length === 0) {
      console.error("Erro: API Google TTS retornou áudio vazio.");
      throw new Error("API retornou áudio vazio.");
    }

    console.log(
      `Áudio recebido da Google TTS, tamanho: ${audioContent.length} bytes`
    );

    // Enviar o áudio gerado como resposta
    res.set("Content-Type", "audio/mp3");
    res.send(audioContent);
    console.log("Áudio gerado e enviado com sucesso para o cliente.");
  } catch (error) {
    console.error("Erro no endpoint /synthesize:", error);
    const errorMessage = error.details || error.message || "Erro desconhecido";
    let statusCode = 500;
    // Mapear códigos de erro específicos do Google TTS se disponíveis
    if (error.code) {
      if (error.code === 3 || error.code === 9)
        statusCode = 400; // INVALID_ARGUMENT, FAILED_PRECONDITION
      else if (error.code === 8) statusCode = 429; // RESOURCE_EXHAUSTED
      else if (error.code === 14) statusCode = 503; // UNAVAILABLE
    }
    res
      .status(statusCode)
      .json({ error: `Erro ao gerar áudio: ${errorMessage}` });
  }
});

// Rota para obter o histórico de textos
app.get("/history/:userId", (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId)
      return res.status(400).json({ error: "ID do usuário é obrigatório" });

    const userTextFile = getUserTextFile(userId);

    if (fs.existsSync(userTextFile)) {
      const content = fs.readFileSync(userTextFile, "utf8");
      res.type("text/plain").send(content); // Enviar como texto plano
    } else {
      console.log(
        `Arquivo de histórico não encontrado para ${userId} em ${userTextFile}`
      );
      res.type("text/plain").send(""); // Enviar string vazia se não existir
    }
  } catch (error) {
    console.error("Erro ao ler histórico:", error);
    res.status(500).json({ error: "Erro interno ao ler histórico" });
  }
});

// Rota para baixar o arquivo de textos completo
app.get("/download-texts/:userId", (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) return res.status(400).send("ID do usuário é obrigatório");

    const userTextFile = getUserTextFile(userId);

    if (!fs.existsSync(userTextFile)) {
      console.log(
        `Tentativa de download de arquivo inexistente: ${userTextFile}`
      );
      return res
        .status(404)
        .send("Arquivo de histórico não encontrado para este usuário.");
    }

    res.download(userTextFile, `textos_${path.basename(userId)}.txt`, (err) => {
      if (err) {
        console.error(
          `Erro ao fazer download do arquivo ${userTextFile}:`,
          err
        );
        // Evitar enviar outra resposta se os headers já foram enviados
        if (!res.headersSent) {
          res
            .status(500)
            .send("Erro interno ao processar o download do arquivo.");
        }
      } else {
        console.log(`Download do arquivo ${userTextFile} iniciado.`);
      }
    });
  } catch (error) {
    console.error("Erro geral na rota /download-texts:", error);
    if (!res.headersSent) {
      res.status(500).send("Erro interno no servidor.");
    }
  }
});

// Rota para gerar mapa mental usando OpenAI e Mermaid
app.post("/generate-mermaid-map", async (req, res) => {
  // Adicionar headers anti-cache no início da resposta
  res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  try {
    if (!openai) {
      throw new Error("Cliente OpenAI não está inicializado.");
    }

    const { userId } = req.body;
    if (!userId)
      return res.status(400).json({ error: "ID do usuário é obrigatório" });

    const userTextFile = getUserTextFile(userId);
    let historyContent = "";
    if (fs.existsSync(userTextFile)) {
      historyContent = fs.readFileSync(userTextFile, "utf8");
    }

    if (!historyContent.trim()) {
      console.log(
        `Histórico vazio para ${userId}. Retornando mapa Mermaid vazio.`
      );
      return res.type("text/plain").send('graph TD\n    A["Histórico Vazio"];');
    }

    console.log(`Gerando mapa mental Mermaid para ${userId}...`);

    const prompt = `
Crie um mapa mental conciso e hierárquico baseado no conteúdo do histórico de textos abaixo.
Use a sintaxe Mermaid (graph TD).
Identifique um tema central ou o tópico mais recorrente como nó raiz (use um ID simples como 'root').
Crie subtópicos ramificados para as principais ideias ou entradas do histórico.
**IMPORTANTE: Defina cada nó usando a sintaxe \`nodeId["Texto do Nó"]\`.**
**Os \`nodeId\` devem ser identificadores curtos e únicos, sem espaços ou caracteres especiais (ex: entry1, topic2, idea3).**
**O "Texto do Nó" (dentro das aspas e colchetes) deve ser o rótulo visível, curto e significativo.**
Exemplo de link válido: \`root["Tema Principal"] --> entry1["Primeira Ideia"]\`
Mantenha os nomes dos nós (rótulos) curtos e significativos.
Não inclua explicações fora do código Mermaid. Apenas o código Mermaid puro.

Conteúdo do Histórico:
---
${historyContent}
---`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5,
      max_tokens: 600, // Aumentado um pouco para mapas maiores
    });

    let mermaidCode = completion.choices[0]?.message?.content?.trim() || "";
    console.log("Resposta recebida da OpenAI.");

    mermaidCode = mermaidCode
      .replace(/^```mermaid\s*/, "")
      .replace(/```$/, "")
      .trim();

    if (!mermaidCode.startsWith("graph")) {
      console.error(
        "Resposta da OpenAI não parece ser um código Mermaid válido:",
        mermaidCode
      );
      throw new Error("Formato de resposta inválido da API de IA.");
    }

    console.log("Código Mermaid gerado com sucesso.");
    res.type("text/plain").send(mermaidCode);
  } catch (error) {
    console.error("Erro ao gerar mapa mental com OpenAI:", error);
    const errorMsg =
      error.response?.data?.error?.message ||
      error.message ||
      "Erro desconhecido";
    // Enviar um código Mermaid de erro para o frontend
    res
      .status(500)
      .type("text/plain")
      .send(
        `graph TD\n    Error["Erro ao gerar mapa: ${errorMsg.replace(
          /"/g,
          ""
        )}"];`
      );
  }
});

// --- Inicialização do Servidor ---
app.listen(port, () => {
  console.log(`Servidor rodando na porta ${port}`);
  console.log(
    `Acessível (localmente) em hhttps://t2s-tavola.vercel.app:${port}`
  );
});

// --- Tratamento de Erros Não Capturados (Opcional, mas bom ter) ---
process.on("uncaughtException", (error) => {
  console.error("Uncaught Exception:", error);
  // Considerar encerrar o processo de forma limpa em produção
  // process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection at:", promise, "reason:", reason);
  // Considerar encerrar o processo de forma limpa em produção
  // process.exit(1);
});
