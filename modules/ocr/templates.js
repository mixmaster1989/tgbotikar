// Описание OCR-шаблонов

/**
 * Возвращает массив всех OCR-шаблонов
 */
function getTemplates() {
  return [
    { pre: 'cropTextBlock', post: 'strong', name: 'cropTextBlock+strong' },
    { pre: 'cropTextBlock', post: 'medium', name: 'cropTextBlock+medium' },
    { pre: 'cropTextBlock', post: 'weak', name: 'cropTextBlock+weak' },
    { pre: 'strong', post: 'medium', name: 'strong+medium' },
    { pre: 'strong', post: 'strong', name: 'strong+strong' },
    { pre: 'strong', post: 'weak', name: 'strong+weak' },
    { pre: 'medium', post: 'strong', name: 'medium+strong' },
    { pre: 'medium', post: 'medium', name: 'medium+medium' },
    { pre: 'medium', post: 'weak', name: 'medium+weak' },
    { pre: 'strongV3', post: 'strong', name: 'strongV3+strong' }
  ];
}

module.exports = {
  getTemplates
};
