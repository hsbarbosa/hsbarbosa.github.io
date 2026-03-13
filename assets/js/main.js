(function () {
  var yearNode = document.getElementById("current-year");
  if (yearNode) yearNode.textContent = String(new Date().getFullYear());

  var mobileQuery = window.matchMedia("(max-width: 800px)");
  var navWrap = document.querySelector(".nav-wrap");
  var siteNav = document.querySelector(".site-nav");
  var dropdowns = document.querySelectorAll(".nav-item-dropdown");

  if (navWrap && siteNav) {
    var navToggle = document.createElement("button");
    navToggle.type = "button";
    navToggle.className = "nav-toggle";
    navToggle.setAttribute("aria-expanded", "false");
    navToggle.setAttribute("aria-label", "Toggle navigation menu");
    navToggle.innerHTML = "<span></span><span></span><span></span>";
    navWrap.insertBefore(navToggle, siteNav);

    navToggle.addEventListener("click", function () {
      var open = navWrap.classList.toggle("nav-open");
      navToggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  }

  dropdowns.forEach(function (item) {
    var link = null;
    var menu = null;
    Array.prototype.forEach.call(item.children, function (child) {
      if (!link && child.tagName === "A") link = child;
      if (!menu && child.classList && child.classList.contains("dropdown-menu")) menu = child;
    });
    if (!link || !menu) return;

    var toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "submenu-toggle";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Toggle submenu for " + link.textContent.trim());
    toggle.innerHTML = "<span></span>";
    item.insertBefore(toggle, menu);

    toggle.addEventListener("click", function () {
      var open = item.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
  });

  function syncMobileMenus() {
    if (navWrap && !mobileQuery.matches) {
      navWrap.classList.remove("nav-open");
      var navToggle = navWrap.querySelector(".nav-toggle");
      if (navToggle) navToggle.setAttribute("aria-expanded", "false");
    }

    dropdowns.forEach(function (item) {
      var toggle = item.querySelector(".submenu-toggle");
      if (!toggle) return;
      if (mobileQuery.matches) return;
      item.classList.remove("is-open");
      toggle.setAttribute("aria-expanded", "false");
    });
  }

  if (typeof mobileQuery.addEventListener === "function") {
    mobileQuery.addEventListener("change", syncMobileMenus);
  } else if (typeof mobileQuery.addListener === "function") {
    mobileQuery.addListener(syncMobileMenus);
  }
  syncMobileMenus();

  var targets = document.querySelectorAll(".hero, .card, .metric, .pub-item, [data-reveal]");
  targets.forEach(function (el) {
    el.classList.add("reveal");
  });

  if (!("IntersectionObserver" in window)) {
    targets.forEach(function (el) {
      el.classList.add("in");
    });
    return;
  }

  var observer = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          observer.unobserve(entry.target);
        }
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.1 }
  );

  targets.forEach(function (el) {
    observer.observe(el);
  });
})();
