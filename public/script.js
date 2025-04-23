document.addEventListener("DOMContentLoaded", function () {
  const textInput = document.getElementById("text-input");
  const themeInput = document.getElementById("theme-input");
  const voiceGender = document.getElementById("voice-gender");
  const generateBtn = document.getElementById("generate-btn");
  const audioPlayer = document.getElementById("audio-player");
  const audioContainer = document.getElementById("audio-container");
  const downloadTextLink = document.getElementById("download-text");
  const downloadMindmapLink = document.getElementById("download-mindmap");
  const historyContainer = document.getElementById("history-container");
  const showMindmapBtn = document.getElementById("show-mindmap-btn");
  const mindmapModal = document.getElementById("mindmap-modal");
  const closeModal = document.getElementById("close-modal");

  // Variável para armazenar os dados do mapa mental
  let mindmapData = null;
  let currentSvgPanZoomInstance = null; // Para guardar a instância do pan/zoom atual

  // Tema padrão caso o usuário não preencha
  const DEFAULT_THEME = "Mapa Mental";

  // Obter ou gerar ID único do usuário
  let userId = localStorage.getItem("textToSpeechUserId");
  if (!userId) {
    userId =
      "user_" + Date.now() + "_" + Math.random().toString(36).substr(2, 9);
    localStorage.setItem("textToSpeechUserId", userId);
  }
  // Para teste, usar ID fixo
  // userId = "test_user";
  console.log("ID do usuário:", userId);

  // Atualizar links de download com ID do usuário e endereço absoluto
  downloadTextLink.href = `/download-texts/${userId}`;
  // Não usar o href pra mindmap, será tratado pelo evento de clique

  // Carregar histórico inicial
  loadHistory();

  // Função para carregar o histórico
  function loadHistory() {
    console.log(`Carregando histórico para usuário: ${userId}`);
    const url = `/history/${userId}`;
    console.log(`URL da requisição: ${url}`);

    fetch(url)
      .then((response) => {
        console.log("Resposta recebida:", response.status);
        return response.text();
      })
      .then((history) => {
        if (history) {
          historyContainer.innerHTML = formatHistory(history);
          // Rolar para o final do histórico
          scrollToBottom();
        } else {
          historyContainer.innerHTML =
            '<p class="text-gray-500 italic text-center">Nenhum texto encontrado no histórico.</p>';
        }
      })
      .catch((error) => {
        console.error("Erro ao carregar histórico:", error);
        historyContainer.innerHTML =
          '<p class="text-red-500 italic text-center">Erro ao carregar histórico.</p>';
      });
  }

  // Função para rolar o histórico para o final
  function scrollToBottom() {
    historyContainer.scrollTop = historyContainer.scrollHeight;
  }

  // Função para formatar o histórico com HTML
  function formatHistory(historyText) {
    if (!historyText.trim())
      return '<p class="text-gray-500 italic text-center">Nenhum texto encontrado no histórico.</p>';

    // Divide por linhas duplas (cada entrada termina com \n\n)
    // const entries = historyText.split("\n\n").filter((entry) => entry.trim());

    // --- NOVA LINHA DE SPLIT ---
    // Divide a string ANTES de cada timestamp [...] que esteja no início de uma linha (após possível \n\n)
    // O (?=...) é um lookahead positivo, garante que o timestamp está lá, mas não o consome na divisão.
    // O .trim() inicial remove espaços/linhas em branco no início/fim do histórico completo.
    const entries = historyText
      .trim()
      .split(/\n\n(?=\[.*?\])/)
      .filter((entry) => entry.trim());
    // ---------------------------

    return entries
      .map((entry) => {
        // Extrair timestamp e texto
        const match = entry.match(/\[(.*?)\]\s*(.*)/s);
        if (!match) return "";

        const timestamp = match[1];
        const text = match[2];

        const formattedText = text.replace(/\n/g, "<br>");

        return `
                <div class="mb-4 bg-white rounded-lg shadow-sm overflow-hidden">
                    <div class="bg-blue-50 px-4 py-2 border-b text-sm text-gray-600 font-medium">
                        ${timestamp}
                    </div>
                    <div class="p-4 text-gray-700">
                        ${formattedText}
                    </div>
                </div>
            `;
      })
      .join("");
  }

  // Adicionar evento para botão de atualizar histórico
  document
    .getElementById("refresh-history")
    .addEventListener("click", function () {
      loadHistory();
    });

  // Função para buscar dados do mapa mental
  async function fetchMindmapData() {
    try {
      // Pegar o tema atual, se estiver preenchido
      const currentTheme = themeInput.value.trim() || DEFAULT_THEME;

      console.log(`Enviando requisição para: /mindmap/${userId}`);
      const response = await fetch(
        `/mindmap/${userId}?theme=${encodeURIComponent(currentTheme)}`,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          mode: "cors",
          cache: "no-cache",
        }
      );

      console.log("Status da resposta:", response.status);

      if (!response.ok) {
        throw new Error(`Erro ao gerar mapa mental: ${response.status}`);
      }

      const responseText = await response.text();
      console.log("Resposta do servidor recebida");

      try {
        let data = JSON.parse(responseText);

        // Garantir que o nome raiz do mapa mental é o tema atual
        // (Sobrescrever o que vem do servidor para garantir consistência)
        if (data && data.id === "root" && currentTheme) {
          data.name = currentTheme;
        }

        return data;
      } catch (parseError) {
        console.error("Erro ao fazer parse do JSON:", parseError);
        throw new Error("Formato de resposta inválido");
      }
    } catch (error) {
      console.error("Erro ao buscar mapa mental:", error);
      throw error;
    }
  }

  // Função para renderizar o mapa mental usando vis.js
  function renderMindmap(data) {
    const container = document.getElementById("mindmap-container");

    // Limpar o container
    container.innerHTML = "";

    // Converter dados do formato proprietário para o formato vis.js
    const nodes = [];
    const edges = [];

    // Adicionar o nó raiz
    nodes.push({
      id: data.id,
      label: data.name,
      shape: "ellipse",
      color: {
        background: "#edf2f7",
        border: "#4299e1",
        highlight: {
          background: "#ebf8ff",
          border: "#3182ce",
        },
      },
      font: { size: 18, bold: true },
      margin: 12,
      widthConstraint: { maximum: 200 },
    });

    // Adicionar nós filhos e conexões - versão simplificada
    if (data.children && data.children.length > 0) {
      data.children.forEach((child) => {
        // Definir cores com base no sentimento
        let nodeColors = {
          background: "#e6fffa",
          border: "#38b2ac",
          highlight: {
            background: "#b2f5ea",
            border: "#319795",
          },
        };

        // Ajustar cores com base no sentimento, se disponível
        if (child.sentiment) {
          if (child.sentiment === "positive") {
            nodeColors = {
              background: "#C6F6D5", // Verde claro
              border: "#38A169", // Verde
              highlight: {
                background: "#9AE6B4",
                border: "#2F855A",
              },
            };
          } else if (child.sentiment === "negative") {
            nodeColors = {
              background: "#FED7D7", // Vermelho claro
              border: "#E53E3E", // Vermelho
              highlight: {
                background: "#FEB2B2",
                border: "#C53030",
              },
            };
          } else {
            nodeColors = {
              background: "#EDF2F7", // Cinza claro
              border: "#4A5568", // Cinza
              highlight: {
                background: "#E2E8F0",
                border: "#2D3748",
              },
            };
          }
        }

        // Criar uma descrição mais completa para o tooltip
        let entryDescription = "";
        if (child.timestamp) {
          entryDescription += `Data: ${child.timestamp}\n`;
        }
        if (child.theme) {
          entryDescription += `Tema: ${child.theme}\n`;
        }
        if (child.sentiment) {
          const sentimentMap = {
            positive: "Positivo",
            negative: "Negativo",
            neutral: "Neutro",
          };
          entryDescription += `Sentimento: ${
            sentimentMap[child.sentiment] || "Neutro"
          }\n`;
        }
        if (child.keywords && child.keywords.length > 0) {
          entryDescription += `Palavras-chave: ${child.keywords.join(", ")}\n`;
        }
        if (child.fullText) {
          entryDescription += `\nTexto completo:\n${child.fullText}`;
        }

        // Adicionar o nó principal do texto
        nodes.push({
          id: child.id,
          label: child.name,
          shape: "box",
          color: nodeColors,
          font: { size: 14 },
          margin: 10,
          widthConstraint: { maximum: 180 },
          title: entryDescription, // Tooltip com informações detalhadas
        });

        // Conectar ao nó raiz
        edges.push({
          from: data.id,
          to: child.id,
          arrows: "to",
          color: { color: "#4299e1" },
          width: 2,
        });

        // Adicionar tópicos como nós conectados ao texto principal
        if (child.keywords && child.keywords.length > 0) {
          // Adicionar um único nó central para "Tópicos"
          const topicsNodeId = `${child.id}-topics`;

          nodes.push({
            id: topicsNodeId,
            label: "Tópicos",
            shape: "ellipse",
            color: {
              background: "#FEF6E4",
              border: "#ED8936",
              highlight: {
                background: "#FEEBC8",
                border: "#DD6B20",
              },
            },
            font: { size: 14, bold: true },
            margin: 8,
            widthConstraint: { maximum: 100 },
          });

          // Conectar o nó de tópicos ao texto
          edges.push({
            from: child.id,
            to: topicsNodeId,
            arrows: "to",
            color: { color: "#ED8936" },
            width: 1.5,
          });

          // Adicionar cada tópico como filho do nó central
          child.keywords.forEach((topic, topicIndex) => {
            const topicId = `${child.id}-topic-${topicIndex}`;

            // Adicionar o nó do tópico
            nodes.push({
              id: topicId,
              label: topic,
              shape: "box",
              color: {
                background: "#FFFAF0",
                border: "#ECC94B",
                highlight: {
                  background: "#FEFCBF",
                  border: "#D69E2E",
                },
              },
              font: { size: 13 },
              margin: 5,
              widthConstraint: { maximum: 150 },
            });

            // Conectar o tópico ao nó central
            edges.push({
              from: topicsNodeId,
              to: topicId,
              arrows: "to",
              color: { color: "#ECC94B" },
              width: 1,
            });
          });
        }
      });
    }

    // Criar rede vis.js
    const data_vis = {
      nodes: new vis.DataSet(nodes),
      edges: new vis.DataSet(edges),
    };

    const options = {
      layout: {
        hierarchical: {
          direction: "UD", // Topo para baixo
          levelSeparation: 120, // Espaço entre níveis
          nodeSpacing: 120, // Espaço entre nós
          treeSpacing: 200, // Espaço entre sub-árvores
          sortMethod: "directed", // Mantém a ordem correta
        },
      },
      interaction: {
        navigationButtons: true,
        keyboard: true,
        hover: true,
        tooltipDelay: 200,
      },
      physics: {
        enabled: false, // Desativa física para manter o layout hierárquico
      },
      nodes: {
        font: {
          face: "Arial, sans-serif",
          size: 16,
        },
        margin: {
          top: 10,
          bottom: 10,
          left: 20,
          right: 20,
        },
        shadow: {
          enabled: true,
          color: "rgba(0,0,0,0.2)",
          size: 5,
        },
      },
      edges: {
        smooth: {
          type: "cubicBezier",
          forceDirection: "vertical",
          roundness: 0.6,
        },
        shadow: {
          enabled: true,
          color: "rgba(0,0,0,0.1)",
          size: 3,
        },
      },
    };

    const network = new vis.Network(container, data_vis, options);

    // Ajustar zoom para mostrar tudo
    network.once("afterDrawing", function () {
      network.fit({
        animation: {
          duration: 1000,
          easingFunction: "easeInOutQuad",
        },
      });
    });

    return network;
  }

  // Função para tratar o download do mapa mental
  downloadMindmapLink.addEventListener("click", async function (e) {
    e.preventDefault();

    try {
      // Exibir mensagem de progresso
      alert("Gerando mapa mental, aguarde...");

      // Buscar dados do mapa mental ou usar dados em cache
      const data = mindmapData || (await fetchMindmapData());
      mindmapData = data; // Salvar para uso futuro

      // Converter para string JSON com formatação para melhor legibilidade
      const jsonStr = JSON.stringify(data, null, 2);

      // Criar blob com os dados do mapa mental
      const blob = new Blob([jsonStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      // Criar link temporário para download
      const tempLink = document.createElement("a");
      tempLink.href = url;
      tempLink.download = `mapa_mental_${userId}.json`;
      document.body.appendChild(tempLink);
      tempLink.click();

      // Limpar
      setTimeout(() => {
        document.body.removeChild(tempLink);
        URL.revokeObjectURL(url);
      }, 100);
    } catch (error) {
      console.error("Erro ao gerar mapa mental:", error);
      alert("Ocorreu um erro ao gerar o mapa mental: " + error.message);
    }
  });

  // Função para mostrar o modal com o mapa mental
  // showMindmapBtn.addEventListener('click', async function() {
  //     try {
  //         // Mostrar o modal
  //         mindmapModal.style.display = 'block';

  //         // Buscar dados do mapa mental se não estiverem em cache
  //         if (!mindmapData) {
  //             try {
  //                 mindmapData = await fetchMindmapData();
  //             } catch (error) {
  //                 console.error('Erro ao buscar dados do mapa mental:', error);
  //                 alert('Erro ao buscar dados do mapa mental: ' + error.message);
  //                 mindmapModal.style.display = 'none';
  //                 return;
  //             }
  //         }

  //         // Renderizar o mapa mental
  //         renderMindmap(mindmapData);

  //     } catch (error) {
  //         console.error('Erro ao mostrar mapa mental:', error);
  //         alert('Erro ao mostrar mapa mental: ' + error.message);
  //         mindmapModal.style.display = 'none';
  //     }
  // });

  // NOVA função para mostrar o modal com o mapa mental (usando Mermaid e OpenAI via backend)
  showMindmapBtn.addEventListener("click", async function () {
    const mindmapContainer = document.getElementById("mindmap-container");
    mindmapContainer.innerHTML =
      '<p class="text-center text-gray-600 p-4">Gerando mapa mental, por favor aguarde...</p>'; // Mensagem de carregamento

    // Destruir instância anterior do svg-pan-zoom se existir
    if (currentSvgPanZoomInstance) {
      currentSvgPanZoomInstance.destroy();
      currentSvgPanZoomInstance = null;
      console.log("Instância anterior de svg-pan-zoom destruída.");
    }

    mindmapModal.style.display = "block"; // Mostrar o modal

    try {
      console.log(`Solicitando geração de mapa mental para usuário: ${userId}`);

      const response = await fetch("/generate-mermaid-map", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/plain",
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache", // Para compatibilidade
          Expires: "0", // Para compatibilidade
        },
        body: JSON.stringify({ userId: userId }),
      });

      console.log(
        "Resposta do /generate-mermaid-map recebida, status:",
        response.status
      );
      const mermaidCode = await response.text();

      if (!response.ok) {
        console.error("Erro retornado pelo backend:", mermaidCode);
      }
      if (!mermaidCode || !mermaidCode.trim().startsWith("graph")) {
        console.error(
          "Código Mermaid inválido ou vazio recebido:",
          mermaidCode
        );
        throw new Error("Não foi possível gerar um mapa mental válido.");
      }

      console.log("Código Mermaid recebido do backend.");

      // Limpar container e preparar para Mermaid
      mindmapContainer.innerHTML = ""; // Limpa a mensagem de carregamento
      const containerId = `mermaid-graph-${Date.now()}`; // ID único para o container do gráfico
      mindmapContainer.innerHTML = `<div id="${containerId}" class="mermaid" style="width: 100%; height: 100%;"></div>`; // Container para Mermaid renderizar

      const graphContainer = document.getElementById(containerId);
      graphContainer.textContent = mermaidCode; // Coloca o código dentro do div

      // Renderizar com Mermaid
      await mermaid.run({
        nodes: [graphContainer], // Passa o elemento div
      });
      console.log("Mapa mental renderizado com Mermaid.");

      // Encontrar o SVG renderizado DENTRO do container
      const svgElement = graphContainer.querySelector("svg");

      if (svgElement) {
        // Ajustar tamanho do SVG (importante para svg-pan-zoom)
        svgElement.style.width = "100%";
        svgElement.style.height = "100%";
        svgElement.style.maxWidth = "none"; // Remover restrições de tamanho máximo se houver

        // Inicializar svg-pan-zoom
        currentSvgPanZoomInstance = svgPanZoom(svgElement, {
          zoomEnabled: true,
          panEnabled: true,
          controlIconsEnabled: true, // Mostra ícones de +/-/reset
          fit: true, // Ajusta o SVG inicial ao container
          center: true, // Centraliza o SVG inicial
          minZoom: 0.5, // Zoom mínimo
          maxZoom: 10, // Zoom máximo
          zoomScaleSensitivity: 0.3, // Sensibilidade do zoom com scroll
          contain: false, // Permite mover o SVG para fora dos limites iniciais
        });
        console.log("svg-pan-zoom inicializado.");

        // Opcional: Ajustar o zoom após a inicialização, se necessário
        // currentSvgPanZoomInstance.zoom(1); // Define zoom inicial para 1x
        window.addEventListener("resize", () => {
          // Reajustar ao redimensionar janela
          if (currentSvgPanZoomInstance) {
            currentSvgPanZoomInstance.resize();
            currentSvgPanZoomInstance.fit();
            currentSvgPanZoomInstance.center();
          }
        });
      } else {
        console.error(
          "Elemento SVG não encontrado após renderização do Mermaid."
        );
        throw new Error("Falha ao encontrar o SVG renderizado.");
      }
    } catch (error) {
      console.error("Erro ao mostrar/gerar mapa mental:", error);
      mindmapContainer.innerHTML = `<p class="text-center text-red-500 p-4">Erro ao gerar o mapa mental: ${error.message}</p>`;
    }
  });

  //   // Fechar o modal quando clicar no X
  //   closeModal.addEventListener("click", function () {
  //     mindmapModal.style.display = "none";
  //   });

  //   // Fechar o modal quando clicar fora do conteúdo
  //   window.addEventListener("click", function (event) {
  //     if (event.target === mindmapModal) {
  //       mindmapModal.style.display = "none";
  //     }
  //   });
  // Modificar o fechamento do modal para destruir a instância do pan/zoom
  function closeModalAndCleanup() {
    mindmapModal.style.display = "none";
    if (currentSvgPanZoomInstance) {
      currentSvgPanZoomInstance.destroy();
      currentSvgPanZoomInstance = null;
      console.log("Instância svg-pan-zoom destruída ao fechar modal.");
    }
    // Limpar o container para a próxima vez
    const mindmapContainer = document.getElementById("mindmap-container");
    mindmapContainer.innerHTML = "";
  }

  closeModal.addEventListener("click", closeModalAndCleanup);
  window.addEventListener("click", function (event) {
    if (event.target === mindmapModal) {
      closeModalAndCleanup();
    }
  });

  generateBtn.addEventListener("click", async function () {
    const text = textInput.value.trim();
    const theme = themeInput.value.trim() || DEFAULT_THEME;
    const gender = voiceGender.value;

    if (!text) {
      alert("Por favor, digite algum texto");
      return;
    }

    generateBtn.disabled = true;
    generateBtn.textContent = "Gerando...";

    try {
      console.log("Enviando requisição para geração de áudio:", {
        text,
        theme,
        gender,
        userId,
      });
      const response = await fetch("/synthesize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "audio/ogg",
        },
        body: JSON.stringify({ text, theme, gender, userId }),
      });

      console.log("Status da resposta:", response.status);
      console.log(
        "Headers da resposta:",
        [...response.headers].map((h) => `${h[0]}: ${h[1]}`).join("\n")
      );

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Resposta de erro:", errorText);
        throw new Error(
          `Erro ao gerar áudio: ${response.status} - ${errorText}`
        );
      }

      // Converter resposta para blob de áudio
      const audioBlob = await response.blob();
      console.log(
        "Blob de áudio recebido, tamanho:",
        audioBlob.size,
        "tipo:",
        audioBlob.type
      );

      if (audioBlob.size === 0) {
        throw new Error("O servidor retornou um áudio vazio");
      }

      const audioUrl = URL.createObjectURL(audioBlob);

      // Configurar o player de áudio
      audioPlayer.src = audioUrl;
      audioContainer.classList.remove("hidden");

      // Adicionar evento para verificar se o áudio carregou corretamente
      audioPlayer.onloadedmetadata = function () {
        console.log(
          "Áudio carregado com sucesso, duração:",
          audioPlayer.duration
        );
      };

      audioPlayer.onerror = function () {
        console.error("Erro ao carregar áudio:", audioPlayer.error);
        alert(
          "Erro ao carregar o áudio. Verifique o console para mais detalhes."
        );
      };

      audioPlayer.play();

      // Limpar campo de texto mas manter o tema
      textInput.value = "";

      // Atualizar histórico após pequeno delay para garantir que o servidor processou o arquivo
      setTimeout(loadHistory, 300);
    } catch (error) {
      console.error("Erro:", error);
      alert("Ocorreu um erro ao gerar o áudio. Por favor, tente novamente.");
    } finally {
      generateBtn.disabled = false;
      generateBtn.textContent = "Gerar Áudio";
    }
  });
  // Adicionar funcionalidade de Impressão e Download SVG
  const printBtn = document.getElementById("print-mindmap-btn");
  const downloadSvgBtn = document.getElementById("download-svg-btn");

  if (printBtn) {
    printBtn.addEventListener("click", function () {
      window.print(); // Dispara a impressão do navegador (requer CSS @media print)
    });
  }

  if (downloadSvgBtn) {
    downloadSvgBtn.addEventListener("click", function () {
      const svgElement = document.querySelector("#mindmap-container svg");
      if (!svgElement) {
        alert("Mapa mental não encontrado para download.");
        return;
      }

      // Obter o código SVG
      const serializer = new XMLSerializer();
      let source = serializer.serializeToString(svgElement);

      // Adicionar namespaces XML necessários para visualizadores de SVG
      if (
        !source.match(/^<svg[^>]+xmlns="http\:\/\/www\.w3\.org\/2000\/svg"/)
      ) {
        source = source.replace(
          /^<svg/,
          '<svg xmlns="http://www.w3.org/2000/svg"'
        );
      }
      if (!source.match(/^<svg[^>]+"http\:\/\/www\.w3\.org\/1999\/xlink"/)) {
        source = source.replace(
          /^<svg/,
          '<svg xmlns:xlink="http://www.w3.org/1999/xlink"'
        );
      }

      // Criar Blob e URL
      const blob = new Blob([source], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);

      // Criar link de download temporário
      const link = document.createElement("a");
      link.href = url;
      link.download = `mapa_mental_${userId || "user"}.svg`; // Nome do arquivo
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url); // Limpar URL do objeto
    });
  }
});
