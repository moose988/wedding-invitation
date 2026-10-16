const target = new URL("../../../index.html", window.location.href);
target.search = window.location.search;
target.hash = window.location.hash;
window.location.replace(target.toString());
