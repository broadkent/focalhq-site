// Sign-up form behavior shared by the landing page and /photographers:
// the thanks state after the redirect, and an inline error in place of the native validation bubble.
(function () {
  var form = document.querySelector('form.signup');
  if (!form) return;
  var note = document.getElementById('signup-note');
  var thanks = document.getElementById('thanks');
  var error = document.getElementById('signup-error');
  var input = form.elements.email;

  if (new URLSearchParams(location.search).has('thanks')) {
    form.hidden = true;
    if (note) note.hidden = true;
    thanks.hidden = false;
    return;
  }

  function clear() {
    error.hidden = true;
    input.removeAttribute('aria-invalid');
  }
  form.addEventListener('submit', function (event) {
    if (input.checkValidity()) return;
    event.preventDefault();
    error.hidden = false;
    input.setAttribute('aria-invalid', 'true');
    input.focus();
  });
  input.addEventListener('input', function () {
    if (input.checkValidity()) clear();
  });
})();
