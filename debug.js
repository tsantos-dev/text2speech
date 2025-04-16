// Arquivo de diagnóstico para teste da rota de mapa mental

async function testMindmapRoute() {
  const userId = "test_user";

  try {
    console.log("Enviando requisição para /mindmap/" + userId);

    const response = await fetch("/mindmap/" + userId, {
      method: "GET",
      headers: {
        Accept: "application/json",
      },
    });

    console.log("Status da resposta:", response.status);
    console.log(
      "Headers da resposta:",
      [...response.headers].map((h) => `${h[0]}: ${h[1]}`).join("\n")
    );

    const responseText = await response.text();
    console.log("Tamanho da resposta:", responseText.length, "bytes");
    console.log(
      "Resposta:",
      responseText.substring(0, 500) + (responseText.length > 500 ? "..." : "")
    );

    if (response.ok) {
      try {
        const data = JSON.parse(responseText);
        console.log("Estrutura do objeto:", Object.keys(data));
        console.log("Número de filhos:", data.children?.length);
      } catch (e) {
        console.error("Erro ao parsear JSON:", e);
      }
    }
  } catch (error) {
    console.error("Erro na requisição:", error);
  }
}

// Executar o teste
testMindmapRoute();
