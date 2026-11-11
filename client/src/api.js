async function request(url, options) {
  let res;
  try {
    res = await fetch(url, options);
  } catch {
    throw new Error('Não foi possível falar com o servidor. Verifique se ele está rodando.');
  }
  if (!res.ok) {
    let message = `Erro ${res.status}`;
    try {
      message = (await res.json()).error || message;
    } catch { /* corpo vazio */ }
    throw new Error(message);
  }
  return res.status === 204 ? null : res.json();
}

const json = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

const form = (method, file, name) => {
  const fd = new FormData();
  if (name) fd.append('name', name);
  fd.append('image', file);
  return { method, body: fd };
};

export const api = {
  listMaps: () => request('/api/maps'),
  getRoot: () => request('/api/maps/root'),
  getMap: (id) => request(`/api/maps/${id}`),
  createMap: (file, name) => request('/api/maps', form('POST', file, name)),
  patchMap: (id, body) => request(`/api/maps/${id}`, json('PATCH', body)),
  replaceImage: (id, file) => request(`/api/maps/${id}/image`, form('PUT', file)),
  deleteMap: (id) => request(`/api/maps/${id}`, { method: 'DELETE' }),
  saveAreas: (id, areas) => request(`/api/maps/${id}/areas`, json('PUT', { areas })),
};

// Baixa a imagem antes de trocar de tela, para a transição não "piscar".
export const preload = (src) =>
  new Promise((resolve) => {
    const img = new Image();
    img.onload = img.onerror = () => resolve();
    img.src = src;
  });
