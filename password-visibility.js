export function bindPasswordVisibility(scope) {
  scope.querySelectorAll('[data-visibility-toggle]').forEach(button => {
    button.addEventListener('click', () => {
      const input = button.parentElement.querySelector('input');
      const visible = input.type === 'password';
      input.type = visible ? 'text' : 'password';
      button.textContent = visible ? 'Hide' : 'Show';
      button.setAttribute('aria-pressed', String(visible));
      button.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} ${button.dataset.visibilityToggle || 'password'}`);
    });
  });
}
export function hidePasswords(scope) {
  scope.querySelectorAll('[data-visibility-toggle]').forEach(button => {
    button.parentElement.querySelector('input').type = 'password';
    button.textContent = 'Show';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', `Show ${button.dataset.visibilityToggle || 'password'}`);
  });
}
