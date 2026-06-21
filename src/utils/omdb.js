const API_KEY = import.meta.env.VITE_OMDB_KEY

export async function fetchOmdbData(imdbId) {
  if (!imdbId || !API_KEY) return null
  try {
    const res = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=${API_KEY}`)
    const data = await res.json()
    if (data.Response === 'False') return null
    return {
      rating: data.imdbRating !== 'N/A' ? data.imdbRating : null,
      votes: data.imdbVotes !== 'N/A' ? data.imdbVotes : null,
      poster: data.Poster !== 'N/A' ? data.Poster : null,
      title: data.Title || null,
      year: data.Year || null,
      runtime: data.Runtime !== 'N/A' ? data.Runtime : null,
      genre: data.Genre !== 'N/A' ? data.Genre : null,
    }
  } catch {
    return null
  }
}
