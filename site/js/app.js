const API_BASE_URL = "http://localhost:8080/api";

const appState = {
  rawNews: [],
  last24hCount: 0,
  filteredNews: [],
  currentView: "all",
};

document.addEventListener("DOMContentLoaded", () => {
  initApp();
});

async function initApp() {
  try {
    const portalsData = await fetchFromApi("/portais");
    const portalsDataRefactored = portalsData.portais;

    setupPortalNavigation(portalsDataRefactored);

    setupEventListeners();

    await loadNews("all");

    setInterval(
      () => {
        loadNews(appState.currentView);
      },
      5 * 60 * 1000,
    );
  } catch (error) {
    console.error("Erro crítico na inicialização:", error);
    renderError(
      "Não foi possível conectar ao servidor. Verifique se a API Java está rodando.",
    );
  }
}

async function fetchFromApi(endpoint) {
  const response = await fetch(`${API_BASE_URL}${endpoint}`);
  if (!response.ok) {
    throw new Error(`Erro na API: ${response.status} - ${response.statusText}`);
  }
  return await response.json();
}

async function loadNews(view) {
  appState.currentView = view;
  showLoader();

  try {
    let data;

    if (view === "all") {
      data = await fetchFromApi("/noticias");
      appState.rawNews = data.noticias;
      appState.last24hCount = data.ultimas24Horas;
    } else if (view === "portals") {
      const groupedData = await fetchFromApi("/portais");
      const groupedDataRefactored = groupedData.portais;
      appState.last24hCount = groupedData.ultimas24Horas;
      appState.rawNews = groupedDataRefactored.flatMap(
        (group) => group.noticias,
      );
    } else if (view.startsWith("portal-")) {
      const portalName = view
        .replace(/^portal-/, "")
        .toLowerCase()
        .replace(/\s+/g, "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "");
      const response = await fetchFromApi(`/${portalName}`);
      appState.last24hCount = response.ultimas24Horas;
      appState.rawNews = response.noticias || [];
    }

    updateLastUpdateTime();

    applyFilters();
  } catch (error) {
    console.error("Erro ao carregar notícias:", error);
    renderError("Erro ao carregar notícias. Tente novamente.");
  }
}

function setupPortalNavigation(data) {
  const portalList = document.getElementById("portal-list");
  const filterSource = document.getElementById("filter-source");

  portalList.innerHTML = "";
  filterSource.innerHTML = '<option value="">Todas</option>';

  const sortedData = [...data].sort((a, b) => a.portal.localeCompare(b.portal));

  sortedData.forEach((item) => {
    const portalName = item.portal;

    const li = document.createElement("li");
    li.innerHTML = `<a href="#" class="nav-link" data-view="portal-${portalName}"><i class="fa-solid fa-angle-right"></i> ${portalName}</a>`;
    portalList.appendChild(li);

    const option = document.createElement("option");
    option.value = portalName;
    option.textContent = portalName;
    filterSource.appendChild(option);
  });
}

function setupEventListeners() {
  document.querySelectorAll(".navigation").forEach((nav) => {
    nav.addEventListener("click", (e) => {
      const link = e.target.closest(".nav-link");
      if (!link) return;

      e.preventDefault();

      document
        .querySelectorAll(".nav-link")
        .forEach((l) => l.classList.remove("active"));
      link.classList.add("active");

      const view = link.dataset.view;
      loadNews(view);
    });
  });

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

  document.getElementById("btn-refresh").addEventListener("click", () => {
    loadNews(appState.currentView);
  });
}

function applyFilters() {
  const sourceFilter = document.getElementById("filter-source").value;
  const dateFilter = document.getElementById("filter-date").value;

  appState.filteredNews = appState.rawNews.filter((news) => {
    const matchSource = sourceFilter ? news.fonte === sourceFilter : true;

    let matchDate = true;
    if (dateFilter && news.data) {
      const dataFormatada = new Date(news.data + "Z");

      const year = dataFormatada.getFullYear();
      const month = String(dataFormatada.getMonth() + 1).padStart(2, "0");
      const day = String(dataFormatada.getDate()).padStart(2, "0");

      const newsDate = `${year}-${month}-${day}`;
      matchDate = newsDate === dateFilter;
    }

    return matchSource && matchDate;
  });

  appState.filteredNews.sort((a, b) => new Date(b.data) - new Date(a.data));

  renderCards(appState.filteredNews);
}

function renderCards(newsList) {
  const container = document.getElementById("news-container");
  container.innerHTML = "";

  if (newsList.length === 0) {
    container.innerHTML =
      '<div class="loader-container"><p>Nenhuma notícia encontrada com os filtros atuais.</p></div>';
    return;
  }

  if (appState.currentView === "portals") {
    container.classList.remove("news-grid");
    container.classList.add("news-list-container");

    const groups = newsList.reduce((acc, news) => {
      if (!acc[news.fonte]) acc[news.fonte] = [];
      acc[news.fonte].push(news);
      return acc;
    }, {});

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

        groups[fonte].forEach((news) => {
          grid.appendChild(createCard(news));
        });

        section.appendChild(grid);
        container.appendChild(section);
      });
  } else {
    container.classList.add("news-grid");
    container.classList.remove("news-list-container");

    newsList.forEach((news) => {
      container.appendChild(createCard(news));
    });
  }

  let novasNoticias = document.getElementsByClassName("highlight-border");
  updateStats(appState.rawNews, novasNoticias);
}

function createCard(news) {
  const tipo = news.tipo || "Geral";
  const cidade = news.cidade
    ? `<span class="badge badge-city"><i class="fa-solid fa-location-dot"></i> ${news.cidade}</span>`
    : "";
  const conteudo = news.conteudo
    ? `<p class="news-summary">${news.conteudo.substring(0, 120)}...</p>`
    : "";

  const dataObj = new Date(news.data + "Z");
  const dataFormatada = dataObj.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const card = document.createElement("article");
  card.className = "news-card";

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
  document.getElementById("stat-new").textContent = novasNoticias.length;
  document.getElementById("stat-new-word").textContent =
    novasNoticias.length > 1 ? "Novas" : "Nova";

  document.getElementById("stat-24h").textContent = appState.last24hCount;
}
