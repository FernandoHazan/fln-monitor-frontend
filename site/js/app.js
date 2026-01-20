const API_BASE_URL = "http://146.235.55.85:8080/api/scraping";

// Estado Global da Aplicação
const appState = {
  rawNews: [], // Todas as notícias recebidas da requisição atual
  filteredNews: [], // Notícias após aplicação dos filtros locais
  currentView: "all", // 'all', 'portals', ou 'portal-{nome}'
};

/**
 * Inicializa a aplicação
 */
document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

async function initApp() {
  try {
    // 1. Busca a lista de portais para montar a navegação lateral
    // Usamos a rota /portais que retorna os grupos, extraímos apenas os nomes
    const portalsData = await fetchFromApi("/portais");
    setupPortalNavigation(portalsData);

    // 2. Configura os Event Listeners (Cliques, Filtros, Refresh)
    setupEventListeners();

    // 3. Carrega a view inicial (Feed Geral)
    await loadNews("all");

    // 4. Inicia o Auto-Refresh (5 minutos)
    setInterval(() => {
      console.log("Executando atualização automática...");
      loadNews(appState.currentView);
    }, 5 * 60 * 1000);
  } catch (error) {
    console.error("Erro crítico na inicialização:", error);
    renderError(
      "Não foi possível conectar ao servidor. Verifique se a API Java está rodando em localhost:8080."
    );
  }
}

/**
 * Função genérica para chamadas à API
 */
async function fetchFromApi(endpoint) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`);
  if (!response.ok) {
    throw new Error(`Erro na API: ${response.status} - ${response.statusText}`);
  }
  return await response.json();
}

/**
 * Gerencia o carregamento de notícias baseado na view selecionada
 */
async function loadNews(view) {
  appState.currentView = view;
  showLoader();

  try {
    let data;

    if (view === "all") {
      // Rota 3: Todas as notícias (Flat list)
      data = await fetchFromApi("/noticias");
      appState.rawNews = data;
    } else if (view === "portals") {
      // Rota 1: Top 5 por portal (Agrupado) -> Precisamos "achatar" para exibir no grid
      const groupedData = await fetchFromApi("/portais");
      appState.rawNews = groupedData.flatMap((group) => group.noticias);
    } else if (view.startsWith("portal-")) {
      // Rota 2: Notícias de um portal específico
      const portalName = view
        .replace(/^portal-/, "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const response = await fetchFromApi(`/${portalName}`);
      appState.rawNews = response.noticias || [];
    }

    // Atualiza timestamp
    updateLastUpdateTime();

    // Aplica filtros (se houver) e renderiza
    applyFilters();
  } catch (error) {
    console.error("Erro ao carregar notícias:", error);
    renderError("Erro ao carregar notícias. Tente novamente.");
  }
}

/**
 * Configura a navegação dinâmica baseada nos portais disponíveis
 */
function setupPortalNavigation(data) {
  const portalList = document.getElementById("portal-list");
  const filterSource = document.getElementById("filter-source");

  // Limpa listas
  portalList.innerHTML = "";
  filterSource.innerHTML = '<option value="">Todas</option>';

  const sortedData = [...data].sort((a, b) => a.portal.localeCompare(b.portal));

  sortedData.forEach((item) => {
    const portalName = item.portal;

    // 1. Sidebar Link
    const li = document.createElement("li");
    li.innerHTML = `<a href="#" class="nav-link" data-view="portal-${portalName}"><i class="fa-solid fa-angle-right"></i> ${portalName}</a>`;
    portalList.appendChild(li);

    // 2. Filtro Select
    const option = document.createElement("option");
    option.value = portalName;
    option.textContent = portalName;
    filterSource.appendChild(option);
  });
}

/**
 * Configura todos os eventos de interação do usuário
 */
function setupEventListeners() {
  // Navegação (Sidebar)
  document.querySelectorAll(".navigation").forEach((nav) => {
    nav.addEventListener("click", (e) => {
      const link = e.target.closest(".nav-link");
      if (!link) return;

      e.preventDefault();

      // UI: Atualiza classe active
      document
        .querySelectorAll(".nav-link")
        .forEach((l) => l.classList.remove("active"));
      link.classList.add("active");

      // Lógica: Carrega a view
      const view = link.dataset.view;
      loadNews(view);
    });
  });

  // Filtros
  document
    .getElementById("filter-source")
    .addEventListener("change", applyFilters);
  document
    .getElementById("filter-date")
    .addEventListener("change", applyFilters);

  document.getElementById("btn-clear-filters").addEventListener("click", () => {
    document.getElementById("filter-source").value = "";
    document.getElementById("filter-date").value = "";
    applyFilters();
  });

  // Botão Atualizar
  document.getElementById("btn-refresh").addEventListener("click", () => {
    loadNews(appState.currentView);
  });
}

/**
 * Filtra as notícias localmente (Client-side) e chama a renderização
 */
function applyFilters() {
  const sourceFilter = document.getElementById("filter-source").value;
  const dateFilter = document.getElementById("filter-date").value;

  appState.filteredNews = appState.rawNews.filter((news) => {
    // Filtro de Fonte
    const matchSource = sourceFilter ? news.fonte === sourceFilter : true;

    // Filtro de Data (Comparando YYYY-MM-DD)
    let matchDate = true;
    if (dateFilter && news.data) {
      let dataFormatada = new Date(news.data + "Z");
      const newsDate = dataFormatada.data.split("T")[0];
      matchDate = newsDate === dateFilter;
    }

    return matchSource && matchDate;
  });

  // Ordenação padrão: Mais recente primeiro
  appState.filteredNews.sort((a, b) => new Date(b.data) - new Date(a.data));

  renderCards(appState.filteredNews);
}

/**
 * Renderiza os cards de notícias no DOM
 */
function renderCards(newsList) {
  const container = document.getElementById("news-container");
  container.innerHTML = "";

  if (newsList.length === 0) {
    container.innerHTML =
      '<div class="loader-container"><p>Nenhuma notícia encontrada com os filtros atuais.</p></div>';
    return;
  }

  // Lógica específica para a visualização "Por Portal (Top 5)"
  if (appState.currentView === "portals") {
    container.classList.remove("news-grid");
    container.classList.add("news-list-container");

    // 1. Agrupar notícias por fonte
    const groups = newsList.reduce((acc, news) => {
      if (!acc[news.fonte]) acc[news.fonte] = [];
      acc[news.fonte].push(news);
      return acc;
    }, {});

    // 2. Criar uma seção para cada portal
    Object.keys(groups)
      .sort()
      .forEach((fonte) => {
        const section = document.createElement("section");
        section.className = "portal-section";

        const title = document.createElement("h2");
        title.className = "portal-title";
        title.innerHTML = `<i class="fa-solid fa-newspaper"></i> ${fonte}`;
        section.appendChild(title);

        const grid = document.createElement("div");
        grid.className = "portal-news-grid";

        // As notícias já vêm ordenadas por data do applyFilters
        groups[fonte].forEach((news) => {
          grid.appendChild(createCard(news));
        });

        section.appendChild(grid);
        container.appendChild(section);
      });
  } else {
    // Visualização Padrão (Grid único)
    container.classList.add("news-grid");
    container.classList.remove("news-list-container");

    newsList.forEach((news) => {
      container.appendChild(createCard(news));
    });
  }

  // Atualiza estatísticas
  let novasNoticias = document.getElementsByClassName("highlight-border");
  updateStats(appState.rawNews, novasNoticias);
}

/**
 * Cria o elemento HTML de um card de notícia
 */
function createCard(news) {
  // Tratamento de Nulos (Null Safety)
  const tipo = news.tipo || "Geral";
  const cidade = news.cidade
    ? `<span class="badge badge-city"><i class="fa-solid fa-location-dot"></i> ${news.cidade}</span>`
    : "";
  const conteudo = news.conteudo
    ? `<p class="news-summary">${news.conteudo.substring(0, 120)}...</p>`
    : "";

  // Formatação de Data
  const dataObj = new Date(news.data + "Z");
  const dataFormatada = dataObj.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Criação do Card
  const card = document.createElement("article");
  card.className = "news-card";

  // Verifica se é recente (menos de 10 min) para destaque
  const isRecent = new Date() - dataObj < 10 * 60 * 1000;
  if (isRecent) card.classList.add("highlight-border");

  card.innerHTML = `
        <div class="card-header">
            <span class="badge badge-source">${news.fonte}</span>
            <span class="news-date">${dataFormatada}</span>
        </div>
        <div class="card-body">
            <a href="${news.link}" target="_blank" class="news-title"><h3>${news.titulo}</h3></a>
            ${conteudo}
        </div>
        <div class="card-footer">
            <span class="badge badge-type">${tipo}</span>
            ${cidade}
            <a href="${news.link}" target="_blank" class="btn-read-more">Ler <i class="fa-solid fa-arrow-up-right-from-square"></i></a>
        </div>
    `;

  return card;
}

// --- Funções Auxiliares de UI ---

function showLoader() {
  document.getElementById("news-container").innerHTML = `
        <div class="loader-container">
            <div class="loader"></div>
            <p>Buscando atualizações...</p>
        </div>`;
}

function renderError(message) {
  document.getElementById("news-container").innerHTML = `
        <div class="loader-container" style="color: var(--danger-color)">
            <i class="fa-solid fa-triangle-exclamation" style="font-size: 2rem; margin-bottom: 1rem;"></i>
            <p>${message}</p>
        </div>`;
}

function updateLastUpdateTime() {
  const now = new Date();
  document.getElementById("last-update-time").textContent =
    now.toLocaleTimeString("pt-BR");
}

function updateStats(newsList, novasNoticias) {
  // Total carregado (Simulação de "Novas" para o MVP)

  document.getElementById("stat-new").textContent = novasNoticias.length;

  // Filtra últimas 24h
  const oneDayAgo = new Date(new Date() - 24 * 60 * 60 * 1000);
  const last24hCount = newsList.filter(
    (n) => new Date(n.data + "Z") > oneDayAgo
  ).length;
  document.getElementById("stat-24h").textContent = last24hCount;
}
