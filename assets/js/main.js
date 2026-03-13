(function () {
  var yearNode = document.getElementById("current-year");
  if (yearNode) yearNode.textContent = String(new Date().getFullYear());

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
