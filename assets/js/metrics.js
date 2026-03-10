(function () {
  var authorId = "A5068497573";
  var authorEndpoint = "https://api.openalex.org/authors/" + authorId;
  var worksEndpoint =
    "https://api.openalex.org/works?filter=author.id:" +
    authorId +
    ",has_doi:true&sort=cited_by_count:desc&per-page=5";
  var recentWorksEndpoint =
    "https://api.openalex.org/works?filter=author.id:" +
    authorId +
    "&sort=publication_date:desc&per-page=12";
  var localStatsPath = "data/auto/stats.json";
  var maxTopPublications = 5;

  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function escapeHtml(text) {
    return String(text || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatInt(value) {
    return new Intl.NumberFormat("en-GB").format(value || 0);
  }

  function formatMetric(value) {
    return value === null || value === undefined ? "N/A" : formatInt(value);
  }

  function decodeInvertedIndex(indexObj) {
    if (!indexObj || typeof indexObj !== "object") return "";
    var positions = [];
    Object.keys(indexObj).forEach(function (word) {
      var locs = indexObj[word];
      if (!Array.isArray(locs)) return;
      locs.forEach(function (pos) {
        positions.push({ pos: pos, word: word });
      });
    });
    positions.sort(function (a, b) {
      return a.pos - b.pos;
    });
    return positions
      .map(function (entry) {
        return entry.word;
      })
      .join(" ");
  }

  function loadAltmetricScript() {
    if (document.querySelector('script[data-altmetric="1"]')) return;
    var script = document.createElement("script");
    script.async = true;
    script.src = "https://d1bxh8uas1mnw7.cloudfront.net/assets/embed.js";
    script.setAttribute("data-altmetric", "1");
    document.body.appendChild(script);
  }

  function renderMetrics(stats) {
    setText("metric-citations", formatMetric(stats.citationCount));
    setText("metric-works", formatMetric(stats.paperCount));
    setText("metric-hindex", formatMetric(stats.hIndex));
    setText("metric-i10", formatMetric(stats.i10Index));
  }

  function isHugoBarbosa(name) {
    if (!name) return false;
    var n = String(name).trim().toLowerCase();
    return (
      (n.indexOf("barbosa") !== -1 && n.indexOf("hugo") !== -1) ||
      /^barbosa,\s*h(?:\.|$|s)/i.test(n)
    );
  }

  function formatAuthorsHtml(authors) {
    if (!Array.isArray(authors) || authors.length === 0) return "Authors unavailable";
    return authors
      .map(function (name) {
        var safeName = escapeHtml(name);
        return isHugoBarbosa(name)
          ? '<span class="author-self">' + safeName + "</span>"
          : safeName;
      })
      .join(", ");
  }

  function renderPublications(publications) {
    var host = document.getElementById("top-publications");
    if (!host) return;

    var ranked = publications
      .slice()
      .sort(function (a, b) {
        var ac = a && a.citationCount !== null && a.citationCount !== undefined ? a.citationCount : -1;
        var bc = b && b.citationCount !== null && b.citationCount !== undefined ? b.citationCount : -1;
        if (bc !== ac) return bc - ac;
        return yearToInt(b && b.year) - yearToInt(a && a.year);
      });

    host.innerHTML = ranked
      .slice(0, maxTopPublications)
      .map(function (pub) {
        var title = pub.title || "Untitled";
        var year = pub.year || "n/a";
        var venue = pub.venue || "";
        var citations = formatInt(pub.citationCount || 0);
        var doi = pub.doiValue || "";
        var link = pub.doiUrl || (doi ? "https://doi.org/" + doi : "");
        var authorsText = formatAuthorsHtml(pub.authors);

        var badge = doi
          ? '<span class="altmetric-embed" data-badge-type="donut" data-doi="' + doi + '"></span>'
          : "";

        return (
          '<li class="pub-item">' +
          '<p class="pub-title">' +
          (link ? '<a href="' + link + '" target="_blank" rel="noopener">' + title + "</a>" : title) +
          "</p>" +
          '<p class="pub-meta">' + year + (venue ? " | " + venue : "") + " | Cited by " + citations + "</p>" +
          '<p class="pub-authors">' + authorsText + "</p>" +
          '<div class="pub-badges">' + badge + "</div>" +
          "</li>"
        );
      })
      .join("");

    loadAltmetricScript();
  }

  function mapOpenAlexWorks(works) {
    return works.map(function (work) {
      var doi = work.doi ? work.doi.replace("https://doi.org/", "") : "";
      return {
        year: work.publication_year,
        publicationDate: work.publication_date || null,
        title: work.display_name,
        venue:
          (work.primary_location &&
            work.primary_location.source &&
            work.primary_location.source.display_name) ||
          "",
        authors: Array.isArray(work.authorships)
          ? work.authorships
              .map(function (a) {
                return a && a.author ? a.author.display_name : "";
              })
              .filter(Boolean)
          : [],
        doiValue: doi || null,
        doiUrl: work.doi || null,
        citationCount: work.cited_by_count || 0,
        abstract: decodeInvertedIndex(work.abstract_inverted_index || null) || null,
      };
    });
  }

  async function loadTopPublicationsFromOpenAlex() {
    var worksRes = await fetch(worksEndpoint);
    if (!worksRes.ok) throw new Error("openalex works fetch failed");
    var worksData = await worksRes.json();
    var works = Array.isArray(worksData.results) ? worksData.results : [];
    renderPublications(mapOpenAlexWorks(works));
  }

  async function loadRecentPublicationsFromOpenAlex() {
    var worksRes = await fetch(recentWorksEndpoint);
    if (!worksRes.ok) throw new Error("openalex recent works fetch failed");
    var worksData = await worksRes.json();
    var works = Array.isArray(worksData.results) ? worksData.results : [];
    renderRecentPublications(mapOpenAlexWorks(works));
  }

  function yearToInt(yearValue) {
    var n = parseInt(yearValue, 10);
    return Number.isNaN(n) ? 0 : n;
  }

  function dateToStamp(value) {
    if (!value || typeof value !== "string") return 0;
    var t = Date.parse(value);
    return Number.isNaN(t) ? 0 : t;
  }

  function renderRecentPublications(publications) {
    var host = document.getElementById("recent-publications");
    if (!host) return;

    var sorted = publications
      .slice()
      .sort(function (a, b) {
        var ad = dateToStamp(a.publicationDate);
        var bd = dateToStamp(b.publicationDate);
        if (bd !== ad) return bd - ad;
        var ay = yearToInt(a.year);
        var by = yearToInt(b.year);
        if (by !== ay) return by - ay;
        return (b.citationCount || 0) - (a.citationCount || 0);
      })
      .slice(0, 3);

    host.innerHTML = sorted
      .map(function (pub) {
        var title = pub.title || "Untitled";
        var venue = pub.venue || "";
        var doi = pub.doiValue || "";
        var link = pub.doiUrl || (doi ? "https://doi.org/" + doi : "");
        var doiLabel = doi ? "DOI: " + doi : "DOI unavailable";

        return (
          '<li class="recent-item">' +
          '<div class="recent-title-row">' +
          '<p class="recent-title">' +
          (link
            ? '<a class="recent-title-link" href="' +
              link +
              '" target="_blank" rel="noopener">' +
              title +
              "</a>"
            : title) +
          "</p>" +
          (link ? '<span class="recent-arrow" aria-hidden="true">↗</span>' : "") +
          "</div>" +
          (venue ? '<p class="recent-venue">' + venue + "</p>" : "") +
          '<p class="recent-doi">' + doiLabel + "</p>" +
          "</li>"
        );
      })
      .join("");
  }

  async function loadFromLocalStats() {
    var res = await fetch(localStatsPath + "?v=" + Date.now());
    if (!res.ok) throw new Error("local stats not available");
    var data = await res.json();
    if (!data || !data.stats || !Array.isArray(data.publications)) {
      throw new Error("invalid stats format");
    }
    renderMetrics(data.stats);
    try {
      await loadRecentPublicationsFromOpenAlex();
    } catch (_err) {
      renderRecentPublications(data.publications);
    }
    if (Array.isArray(data.topPublications) && data.topPublications.length > 0) {
      renderPublications(data.topPublications);
      return;
    }
    // Always prefer all-time top-cited list from OpenAlex on the publications page.
    try {
      await loadTopPublicationsFromOpenAlex();
    } catch (_err) {
      renderPublications(data.publications);
    }
  }

  async function loadFromOpenAlex() {
    var metricsRes = await fetch(authorEndpoint);
    if (!metricsRes.ok) throw new Error("openalex author fetch failed");
    var metricsData = await metricsRes.json();
    renderMetrics({
      citationCount: metricsData.cited_by_count,
      paperCount: metricsData.works_count,
      hIndex: metricsData.summary_stats && metricsData.summary_stats.h_index,
      i10Index: metricsData.summary_stats && metricsData.summary_stats.i10_index,
    });

    var worksRes = await fetch(worksEndpoint);
    if (!worksRes.ok) throw new Error("openalex works fetch failed");
    var worksData = await worksRes.json();
    var works = Array.isArray(worksData.results) ? worksData.results : [];
    renderPublications(mapOpenAlexWorks(works));
    await loadRecentPublicationsFromOpenAlex();
  }

  async function init() {
    try {
      await loadFromLocalStats();
      return;
    } catch (_err) {
      // Continue to API fallback below.
    }

    try {
      await loadFromOpenAlex();
    } catch (_err) {
      setText("metric-citations", "N/A");
      setText("metric-works", "N/A");
      setText("metric-hindex", "N/A");
      setText("metric-i10", "N/A");

      var host = document.getElementById("top-publications");
      if (host) {
        host.innerHTML =
          '<li class="pub-item"><p class="pub-meta">Publication metrics are temporarily unavailable.</p></li>';
      }
      var recentHost = document.getElementById("recent-publications");
      if (recentHost) {
        recentHost.innerHTML =
          '<li class="recent-item"><p class="recent-title">Recent publications are temporarily unavailable.</p></li>';
      }
    }
  }

  init();
})();
