const express = require("express");
const bodyParser = require("body-parser");
const fs = require("fs");
const path = require("path");
const textToSpeech = require("@google-cloud/text-to-speech");
const cors = require("cors");

const app = express();
const port = 3000;

// ADICIONADO PARA NOVO MAPA MENTAL
require("dotenv").config(); // Carrega variáveis do .env
const { OpenAI } = require("openai"); // Importar a classe correta
// Inicializar cliente OpenAI (FORA da rota)
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY, // Usa a chave da variável de ambiente
});
// ###################################

// Configuração do middleware
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Accept"],
  })
);
app.use(bodyParser.json());
app.use(express.static("."));

// Middleware para log de requisições
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});

// Inicializar o cliente TTS com o arquivo de credenciais
const keyPath = path.join(__dirname, "key.json");
console.log(
  `Caminho do arquivo de credenciais: ${keyPath} (existe: ${fs.existsSync(
    keyPath
  )})`
);

// Inicialização simplificada
let client;
try {
  client = new textToSpeech.TextToSpeechClient({
    keyFilename: keyPath,
  });
  console.log("Cliente Google TTS inicializado com sucesso");
} catch (error) {
  console.error("Erro ao inicializar cliente Google TTS:", error);
  // Cliente fictício para caso de erro
  client = {
    synthesizeSpeech: async () => {
      return [{ audioContent: Buffer.from([0xff, 0xfb, 0x90, 0x64]) }];
    },
  };
  console.log("Cliente fictício criado para testes");
}

// Pasta para armazenar os textos de usuários
const textsDir = path.join(__dirname, "user_texts");
if (!fs.existsSync(textsDir)) {
  fs.mkdirSync(textsDir, { recursive: true });
}

// Função para obter o caminho do arquivo de um usuário específico
function getUserTextFile(userId) {
  return path.join(textsDir, `${userId}.txt`);
}

// Rota para converter texto para fala
app.post("/synthesize", async (req, res) => {
  // Bloco try principal para erros gerais de processamento da requisição
  try {
    console.log("Requisição /synthesize recebida:", req.body);
    const { text, theme, gender, userId } = req.body;

    // --- Validação de Entrada ---
    if (!text) {
      console.warn("Requisição /synthesize rejeitada: Texto ausente.");
      return res.status(400).json({ error: "Texto é obrigatório" });
    }
    if (!userId) {
      console.warn("Requisição /synthesize rejeitada: ID do usuário ausente.");
      return res.status(400).json({ error: "ID do usuário é obrigatório" });
    }
    if (!gender || (gender !== "male" && gender !== "female")) {
      console.warn(
        `Requisição /synthesize: Gênero inválido ou ausente ('${gender}'). Usando 'MALE' como padrão.`
      );
      // Poderia retornar erro 400, mas vamos definir um padrão
      // return res.status(400).json({ error: 'Gênero inválido. Use "male" ou "female".' });
    }

    // --- Salvamento do Histórico (Mantido como estava) ---
    const userTextFile = getUserTextFile(userId);
    console.log("Arquivo do usuário:", userTextFile);
    const timestamp = new Date().toLocaleString("pt-BR");
    const themePart = theme ? `[Tema: ${theme}] ` : "";
    const textEntry = `[${timestamp}] ${themePart}${text}\n\n`;
    try {
      fs.appendFileSync(userTextFile, textEntry);
      console.log("Texto salvo no arquivo do usuário");
    } catch (fileError) {
      console.error(
        `Erro ao salvar texto no arquivo ${userTextFile}:`,
        fileError
      );
      // Continuar mesmo se o salvamento falhar, mas logar o erro.
      // Poderia retornar um erro 500 aqui se o salvamento for crítico.
    }

    // --- Geração de Áudio com Google TTS (Lógica Correta) ---

    // Verificar se o cliente TTS está operacional
    if (!client || typeof client.synthesizeSpeech !== "function") {
      console.error(
        "Erro Crítico: Cliente Google TTS não está inicializado ou é inválido."
      );
      // Tentar reinicializar (opcional, pode não funcionar se o erro inicial persistir)
      try {
        client = new textToSpeech.TextToSpeechClient({ keyFilename: keyPath });
        console.log("Cliente Google TTS reinicializado.");
        if (!client || typeof client.synthesizeSpeech !== "function") {
          throw new Error("Falha ao reinicializar cliente TTS.");
        }
      } catch (initError) {
        console.error(
          "Erro fatal ao inicializar/reinicializar cliente Google TTS:",
          initError
        );
        // Retornar erro 503 (Serviço Indisponível) é mais apropriado aqui
        return res.status(503).json({
          error: "Serviço de Text-to-Speech indisponível no momento.",
        });
      }
    }

    // Mapear o gênero recebido ('male', 'female') para o formato da API ('MALE', 'FEMALE')
    // Garante 'MALE' como padrão se 'gender' for inválido ou ausente
    const ssmlGender =
      gender && gender.toUpperCase() === "FEMALE" ? "FEMALE" : "MALE";

    // Configurar a requisição para a API do Google TTS
    const ttsRequest = {
      input: { text: text },
      // Selecionar o tipo de voz e idioma
      voice: {
        languageCode: "pt-BR", // Português do Brasil
        ssmlGender: ssmlGender,
        // Para usar vozes específicas (melhor qualidade, pode ter custo diferente):
        // Descomente e ajuste UMA das linhas abaixo conforme necessário:
        // name: ssmlGender === 'FEMALE' ? 'pt-BR-Wavenet-A' : 'pt-BR-Wavenet-B', // Exemplo WaveNet
        // name: ssmlGender === 'FEMALE' ? 'pt-BR-Standard-A' : 'pt-BR-Standard-B', // Exemplo Standard
      },
      // Selecionar o formato do áudio
      audioConfig: {
        audioEncoding: "MP3", // Formato MP3
        // Você pode ajustar a taxa de bits e sample rate aqui se necessário
        // speakingRate: 1.0, // Velocidade da fala (1.0 = normal)
        // pitch: 0, // Tom da voz (0 = normal)
      },
    };

    console.log(
      "Enviando requisição para Google TTS:",
      JSON.stringify(
        {
          input: {
            text: text.substring(0, 50) + (text.length > 50 ? "..." : ""),
          }, // Log truncado
          voice: ttsRequest.voice,
          audioConfig: ttsRequest.audioConfig,
        },
        null,
        2
      )
    );

    // Chamar a API para sintetizar a fala dentro de um try...catch específico para a API
    try {
      const [ttsResponse] = await client.synthesizeSpeech(ttsRequest);
      const audioContent = ttsResponse.audioContent;

      // Verificar se o áudio foi realmente gerado
      if (!audioContent || audioContent.length === 0) {
        console.error("Erro: API Google TTS retornou áudio vazio.");
        throw new Error("API retornou áudio vazio."); // Será pego pelo catch abaixo
      }

      console.log(
        `Áudio recebido da Google TTS, tamanho: ${audioContent.length} bytes`
      );

      // Enviar o áudio gerado como resposta
      res.set("Content-Type", "audio/mp3");
      res.send(audioContent);
      console.log("Áudio gerado e enviado com sucesso para o cliente.");
    } catch (ttsError) {
      // Captura erros específicos da chamada à API TTS
      console.error("Erro ao chamar a API Google TTS:", ttsError);
      // Tentar fornecer uma mensagem de erro mais específica da API, se disponível
      const errorMessage =
        ttsError.details || ttsError.message || "Erro desconhecido na API TTS";
      // Mapear códigos de erro comuns da API para status HTTP apropriados
      // 3: INVALID_ARGUMENT -> 400 Bad Request
      // 8: RESOURCE_EXHAUSTED (Quota) -> 429 Too Many Requests
      // 9: FAILED_PRECONDITION (e.g., API not enabled) -> 400 Bad Request or 500 Internal Server Error
      // 14: UNAVAILABLE -> 503 Service Unavailable
      let statusCode = 500; // Padrão para erro interno do servidor
      if (ttsError.code === 3 || ttsError.code === 9) {
        statusCode = 400;
      } else if (ttsError.code === 8) {
        statusCode = 429;
      } else if (ttsError.code === 14) {
        statusCode = 503;
      }
      res
        .status(statusCode)
        .json({ error: `Erro ao gerar áudio via Google TTS: ${errorMessage}` });
    }
  } catch (error) {
    // Captura erros gerais que podem ocorrer antes da chamada da API TTS (ex: erro de validação, erro de I/O no appendFileSync se não tratado antes)
    console.error("Erro geral ao processar requisição /synthesize:", error);
    res.status(500).json({
      error: `Erro interno no servidor ao processar requisição: ${error.message}`,
    });
  }
});
// app.post('/synthesize', async (req, res) => {
//     try {
//         console.log('Requisição /synthesize recebida:', req.body);
//         const { text, theme, gender, userId } = req.body;

//         if (!text) {
//             return res.status(400).json({ error: 'Texto é obrigatório' });
//         }

//         if (!userId) {
//             return res.status(400).json({ error: 'ID do usuário é obrigatório' });
//         }

//         // Obter arquivo específico do usuário
//         const userTextFile = getUserTextFile(userId);
//         console.log('Arquivo do usuário:', userTextFile);

//         // Salvar texto no arquivo do usuário, incluindo o tema
//         const timestamp = new Date().toLocaleString('pt-BR');
//         const themePart = theme ? `[Tema: ${theme}] ` : '';
//         const textEntry = `[${timestamp}] ${themePart}${text}\n\n`;

//         fs.appendFileSync(userTextFile, textEntry);
//         console.log('Texto salvo no arquivo do usuário');

//         // Ler um arquivo de áudio MP3 real em vez de gerar dados falsos
//         try {
//             // Caminho para um arquivo MP3 de exemplo válido
//             const sampleAudioPath = path.join(__dirname, 'sample.mp3');

//             // Verificar se o arquivo de áudio de exemplo existe
//             if (fs.existsSync(sampleAudioPath)) {
//                 // Ler o arquivo de áudio
//                 const audioData = fs.readFileSync(sampleAudioPath);
//                 console.log(`Usando arquivo de áudio de exemplo: ${sampleAudioPath}, tamanho: ${audioData.length} bytes`);

//                 // Enviar o áudio real de volta
//                 res.set('Content-Type', 'audio/mp3');
//                 res.send(audioData);
//             } else {
//                 // Se não houver arquivo de áudio, criar um MP3 válido simples
//                 // Este é um MP3 válido real com 1 segundo de silêncio
//                 const validMp3Header = Buffer.from([
//                     0xFF, 0xFB, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
//                     0xFF, 0xFB, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
//                     0xFF, 0xFB, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
//                     0xFF, 0xFB, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
//                     0xFF, 0xFB, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
//                     0xFF, 0xFB, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
//                     0xFF, 0xFB, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
//                     0xFF, 0xFB, 0x50, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00
//                 ]);

//                 console.log('Usando MP3 de silêncio gerado, tamanho:', validMp3Header.length);

//                 // Enviar o áudio gerado de volta
//                 res.set('Content-Type', 'audio/mp3');
//                 res.send(validMp3Header);
//             }
//         } catch (audioError) {
//             console.error('Erro ao preparar áudio:', audioError);

//             // Em caso de erro, enviar uma resposta de erro
//             res.status(500).json({ error: 'Erro ao gerar áudio de teste' });
//         }
//         console.log('Áudio de teste enviado com sucesso');

//     } catch (error) {
//         console.error('Erro ao processar requisição:', error);
//         res.status(500).json({ error: `Erro ao processar requisição: ${error.message}` });
//     }
// });

// Rota para baixar o arquivo de textos
app.get("/download-texts/:userId", (req, res) => {
  const userId = req.params.userId;
  if (!userId) {
    return res.status(400).send("ID do usuário é obrigatório");
  }

  const userTextFile = getUserTextFile(userId);

  // Verificar se o arquivo existe
  if (!fs.existsSync(userTextFile)) {
    return res.status(404).send("Arquivo não encontrado");
  }

  res.download(userTextFile, `textos_${userId}.txt`, (err) => {
    if (err) {
      console.error("Erro ao fazer download do arquivo:", err);
      res.status(500).send("Erro ao fazer download do arquivo");
    }
  });
});

// Lista de stop words em português
const stopWords = [
  "a",
  "à",
  "ao",
  "aos",
  "aquela",
  "aquelas",
  "aquele",
  "aqueles",
  "aquilo",
  "as",
  "às",
  "até",
  "com",
  "como",
  "da",
  "das",
  "de",
  "dela",
  "delas",
  "dele",
  "deles",
  "depois",
  "do",
  "dos",
  "e",
  "é",
  "ela",
  "elas",
  "ele",
  "eles",
  "em",
  "entre",
  "era",
  "eram",
  "éramos",
  "essa",
  "essas",
  "esse",
  "esses",
  "esta",
  "estas",
  "este",
  "estes",
  "eu",
  "foi",
  "fomos",
  "for",
  "foram",
  "fosse",
  "fossem",
  "há",
  "isso",
  "isto",
  "já",
  "lhe",
  "lhes",
  "mais",
  "mas",
  "me",
  "mesmo",
  "meu",
  "meus",
  "minha",
  "minhas",
  "muito",
  "muitos",
  "na",
  "não",
  "nas",
  "nem",
  "no",
  "nos",
  "nós",
  "nossa",
  "nossas",
  "nosso",
  "nossos",
  "num",
  "numa",
  "o",
  "os",
  "ou",
  "para",
  "pela",
  "pelas",
  "pelo",
  "pelos",
  "por",
  "qual",
  "quando",
  "que",
  "quem",
  "são",
  "se",
  "seja",
  "sejam",
  "sejamos",
  "sem",
  "será",
  "serão",
  "seria",
  "seriam",
  "seu",
  "seus",
  "só",
  "somos",
  "sua",
  "suas",
  "também",
  "te",
  "tem",
  "tém",
  "temos",
  "tenho",
  "ter",
  "teu",
  "teus",
  "tu",
  "tua",
  "tuas",
  "um",
  "uma",
  "você",
  "vocês",
  "vos",
];

// Função para extrair tópicos em vez de apenas palavras-chave
function extractKeywords(text, maxKeywords = 5) {
  // Normalizar o texto (minúsculas e remover caracteres especiais)
  const normalized = text
    .toLowerCase()
    .replace(/[^\wÀ-ÿ\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Dividir o texto em palavras e filtrar stop words
  const words = normalized
    .split(" ")
    .filter((word) => word.length > 3 && !stopWords.includes(word));

  // Buscar frases de 2-3 palavras que são mais significativas
  const phrases = [];
  for (let i = 0; i < words.length - 1; i++) {
    // Frases de 2 palavras
    if (i < words.length - 1) {
      const phrase2 = words[i] + " " + words[i + 1];
      if (phrase2.length > 5) {
        phrases.push(phrase2);
      }
    }

    // Frases de 3 palavras
    if (i < words.length - 2) {
      const phrase3 = words[i] + " " + words[i + 1] + " " + words[i + 2];
      if (phrase3.length > 8) {
        phrases.push(phrase3);
      }
    }
  }

  // Contar frequência de palavras individuais para usar como backup
  const wordFrequency = {};
  words.forEach((word) => {
    if (word.length > 3) {
      wordFrequency[word] = (wordFrequency[word] || 0) + 1;
    }
  });

  // Combinar frases e palavras, priorizando frases
  let topics = [];

  // Adicionar frases primeiro (se existirem) - limitando ao número de tópicos desejados
  if (phrases.length > 0) {
    // Pegar frases únicas
    const uniquePhrases = [...new Set(phrases)];
    // Adicionar as primeiras frases (até maxKeywords/2)
    topics = uniquePhrases.slice(0, Math.ceil(maxKeywords / 2));
  }

  // Complementar com palavras-chave individuais mais frequentes
  if (topics.length < maxKeywords) {
    const remainingSlots = maxKeywords - topics.length;
    const individualWords = Object.entries(wordFrequency)
      .sort((a, b) => b[1] - a[1])
      .slice(0, remainingSlots)
      .map((entry) => entry[0]);

    // Adicionar palavras que não já estão nas frases
    individualWords.forEach((word) => {
      if (!topics.some((topic) => topic.includes(word))) {
        topics.push(word);
      }
    });
  }

  // Limitar ao número máximo e capitalizar para melhor apresentação
  return topics.slice(0, maxKeywords).map((topic) =>
    topic
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ")
  );
}

// Função para detectar o sentimento de um texto (simplificada)
function detectSentiment(text) {
  // Lista simples de palavras positivas e negativas em português
  const positiveWords = [
    "bom",
    "feliz",
    "ótimo",
    "excelente",
    "maravilhoso",
    "adorável",
    "incrível",
    "fantástico",
    "amor",
    "alegre",
    "contente",
    "satisfeito",
    "sucesso",
    "gosto",
    "legal",
    "perfeito",
    "melhor",
    "adoro",
    "gostei",
    "positivo",
    "parabéns",
  ];

  const negativeWords = [
    "mau",
    "ruim",
    "péssimo",
    "terrível",
    "horrível",
    "detestável",
    "infeliz",
    "triste",
    "decepcionante",
    "decepção",
    "ódio",
    "raiva",
    "frustração",
    "pior",
    "desastre",
    "problema",
    "falha",
    "erro",
    "difícil",
    "complicado",
    "negativo",
  ];

  // Normalizar o texto
  const normalized = text.toLowerCase();

  // Contar palavras positivas e negativas
  let positiveCount = 0;
  let negativeCount = 0;

  positiveWords.forEach((word) => {
    const regex = new RegExp("\\b" + word + "\\b", "g");
    const matches = normalized.match(regex);
    if (matches) positiveCount += matches.length;
  });

  negativeWords.forEach((word) => {
    const regex = new RegExp("\\b" + word + "\\b", "g");
    const matches = normalized.match(regex);
    if (matches) negativeCount += matches.length;
  });

  // Determinar o sentimento
  if (positiveCount > negativeCount) {
    return "positive";
  } else if (negativeCount > positiveCount) {
    return "negative";
  } else {
    return "neutral";
  }
}

// Função para extrair o tema de um texto
function extractTheme(text) {
  // Tentar extrair o tema marcado com [Tema: ...]
  const themeMatch = text.match(/\[Tema:\s*([^\]]+)\]/);
  if (themeMatch && themeMatch[1]) {
    return themeMatch[1].trim();
  }
  return null;
}

// Função para gerar um mapa mental a partir do texto de forma simplificada
function generateMindmap(textContent) {
  if (!textContent || !textContent.trim()) {
    return { id: "root", name: "Mapa Mental", children: [] };
  }

  // Dividir o conteúdo em entradas
  const entries = textContent.split("\n\n").filter((entry) => entry.trim());

  // Buscar tema geral nos textos
  let rootTheme = "Histórico de Textos";
  const themes = entries
    .map((entry) => extractTheme(entry))
    .filter((theme) => theme !== null);

  // Se encontrar temas recorrentes, usar o mais frequente como raiz
  if (themes.length > 0) {
    // Contar frequência de temas
    const themeCounts = {};
    themes.forEach((theme) => {
      themeCounts[theme] = (themeCounts[theme] || 0) + 1;
    });

    // Encontrar o tema mais frequente
    const mostFrequentTheme = Object.entries(themeCounts).sort(
      (a, b) => b[1] - a[1]
    )[0][0];

    rootTheme = mostFrequentTheme;
  }

  // Criar objeto raiz do mapa mental com o tema como nome
  const mindmap = {
    id: "root",
    name: rootTheme,
    children: [],
  };

  // Adicionar entradas como nós filhos (versão simplificada)
  entries.forEach((entry, index) => {
    // Extrair timestamp e texto
    const timestampMatch = entry.match(/\[(.*?)\]/);
    if (!timestampMatch) return;

    // Pegar o timestamp da primeira ocorrência de [...]
    const timestamp = timestampMatch[1];

    // Remover o timestamp do texto
    let remainingText = entry.replace(timestampMatch[0], "").trim();

    // Extrair o tema se estiver presente
    let nodeTheme = null;
    const themeMatch = remainingText.match(/\[Tema:\s*([^\]]+)\]/);
    if (themeMatch) {
      nodeTheme = themeMatch[1].trim();
      // Remover a parte do tema do texto
      remainingText = remainingText.replace(themeMatch[0], "").trim();
    }

    // O texto restante é o conteúdo real
    const text = remainingText;

    // Limitar texto para o nó principal
    const nodeText = text.length > 50 ? text.substring(0, 50) + "..." : text;

    // Extrair palavras-chave (limitando a 5 para simplificar)
    const keywords = extractKeywords(text, 5);

    // Detectar sentimento
    const sentiment = detectSentiment(text);

    // Criar o título do nó incluindo o tema se existir
    let nodeName = nodeText;
    if (nodeTheme && nodeTheme !== rootTheme) {
      nodeName = `${nodeTheme}: ${nodeText}`;
    }

    // Criar nó do texto (simplificado - sem hierarquia complexa)
    const node = {
      id: `entry-${index}`,
      name: nodeName,
      timestamp: timestamp,
      theme: nodeTheme,
      fullText: text,
      sentiment: sentiment,
      keywords: keywords,
    };

    mindmap.children.push(node);
  });

  return mindmap;
}

// Rota para obter o histórico de textos
app.get("/history/:userId", (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) {
      return res.status(400).json({ error: "ID do usuário é obrigatório" });
    }

    const userTextFile = getUserTextFile(userId);

    if (fs.existsSync(userTextFile)) {
      const content = fs.readFileSync(userTextFile, "utf8");
      res.send(content);
    } else {
      res.send("");
    }
  } catch (error) {
    console.error("Erro ao ler histórico:", error);
    res.status(500).json({ error: "Erro ao ler histórico" });
  }
});

// Rota para gerar e baixar mapa mental
app.get("/mindmap/:userId", (req, res) => {
  try {
    const userId = req.params.userId;
    if (!userId) {
      return res.status(400).json({ error: "ID do usuário é obrigatório" });
    }

    // Obter tema da query string, se disponível
    const explicitTheme = req.query.theme;

    const userTextFile = getUserTextFile(userId);

    if (fs.existsSync(userTextFile)) {
      const content = fs.readFileSync(userTextFile, "utf8");

      // Gerar mapa mental (passando o tema explícito, se fornecido)
      const mindmap = generateMindmap(content);

      // Substituir o nome raiz com o tema explícito se fornecido
      if (explicitTheme) {
        mindmap.name = explicitTheme;
      }

      // Definir cabeçalhos CORS explicitamente
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET");
      res.header("Access-Control-Allow-Headers", "Content-Type");

      // Enviar resposta JSON
      res.json(mindmap);
    } else {
      // Definir cabeçalhos CORS explicitamente
      res.header("Access-Control-Allow-Origin", "*");
      res.header("Access-Control-Allow-Methods", "GET");
      res.header("Access-Control-Allow-Headers", "Content-Type");

      // Usar o tema da query string como nome do mapa, se fornecido
      const emptyName = explicitTheme || "Mapa Mental (Vazio)";
      res.json({ id: "root", name: emptyName, children: [] });
    }
  } catch (error) {
    console.error("Erro ao gerar mapa mental:", error);
    res.status(500).json({ error: "Erro ao gerar mapa mental" });
  }
});

// Rota raiz para verificação de disponibilidade do servidor
app.get("/", (req, res) => {
  res.status(200).send("Servidor rodando");
});

// Endpoint de diagnóstico
app.get("/debug", (req, res) => {
  try {
    // Informações do servidor
    const serverInfo = {
      timestamp: new Date().toISOString(),
      nodeVersion: process.version,
      platform: process.platform,
      architecture: process.arch,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime(),
    };

    // Informações de arquivos
    const filesInfo = {
      textsDir: textsDir,
      dirExists: fs.existsSync(textsDir),
      files: fs.existsSync(textsDir) ? fs.readdirSync(textsDir) : [],
    };

    // Verificar arquivo específico
    const testUserFile = getUserTextFile("test_user");
    const testUserInfo = {
      path: testUserFile,
      exists: fs.existsSync(testUserFile),
      size: fs.existsSync(testUserFile) ? fs.statSync(testUserFile).size : 0,
      content: fs.existsSync(testUserFile)
        ? fs.readFileSync(testUserFile, "utf8")
        : "",
    };

    // Enviar informações como JSON
    res.json({
      server: serverInfo,
      files: filesInfo,
      testUser: testUserInfo,
    });
  } catch (error) {
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.listen(port, () => {
  console.log(`Servidor rodando em http://localhost:${port}`);
});

// Rota para gerar mapa mental usando OpenAI e Mermaid
app.post("/generate-mermaid-map", async (req, res) => {
  try {
    const { userId } = req.body; // Receber userId do frontend

    if (!userId) {
      console.warn(
        "Requisição /generate-mermaid-map rejeitada: ID do usuário ausente."
      );
      return res.status(400).json({ error: "ID do usuário é obrigatório" });
    }

    // Obter o arquivo de histórico do usuário
    const userTextFile = getUserTextFile(userId);
    let historyContent = "";
    if (fs.existsSync(userTextFile)) {
      historyContent = fs.readFileSync(userTextFile, "utf8");
    }

    if (!historyContent.trim()) {
      console.log(`Histórico vazio para ${userId}. Retornando mapa vazio.`);
      // Retorna um mapa Mermaid básico vazio
      return res.type("text/plain").send('graph TD\n    A["Histórico Vazio"];');
    }

    console.log(`Gerando mapa mental para ${userId} com base no histórico.`);

    // Construir o prompt para a OpenAI
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
---
        `;

    // Chamar a API da OpenAI
    console.log("Enviando requisição para OpenAI...");
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Ou "gpt-4" se preferir (mais caro/lento)
      messages: [{ role: "user", content: prompt }],
      temperature: 0.5, // Um pouco menos criativo para seguir a estrutura
      max_tokens: 500, // Limitar o tamanho da resposta
    });

    let mermaidCode = completion.choices[0]?.message?.content?.trim() || "";
    console.log("Resposta recebida da OpenAI.");

    // Limpeza básica para garantir que é código Mermaid
    // Remove ```mermaid e ``` se presentes
    mermaidCode = mermaidCode
      .replace(/^```mermaid\s*/, "")
      .replace(/```$/, "")
      .trim();

    // Validação simples (verifica se começa com 'graph')
    if (!mermaidCode.startsWith("graph")) {
      console.error(
        "Resposta da OpenAI não parece ser um código Mermaid válido:",
        mermaidCode
      );
      // Retornar um mapa de erro
      return res
        .type("text/plain")
        .send('graph TD\n    Error["Erro ao gerar mapa"];');
      // Ou throw new Error('Formato inválido da OpenAI'); // Para ser pego pelo catch
    }

    console.log("Código Mermaid gerado:", mermaidCode);

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    // Enviar apenas o código Mermaid como texto plano
    res.type("text/plain").send(mermaidCode);
  } catch (error) {
    console.error("Erro ao gerar mapa mental com OpenAI:", error);
    // Enviar um código Mermaid de erro para o frontend
    const errorMsg =
      error.response?.data?.error?.message ||
      error.message ||
      "Erro desconhecido";
    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");

    res
      .status(500)
      .type("text/plain")
      .send(`graph TD\n    Error["Erro: ${errorMsg.replace(/"/g, "")}"];`); // Envia um nó de erro
  }
});
