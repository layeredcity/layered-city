// Prints the ElevenLabs plan, credits used, and the next reset date.
// Runs in .github/workflows/elevenlabs-usage.yml.
const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY } })
const d = await r.json()
console.log(`::notice::tier=${d.tier} used=${d.character_count} limit=${d.character_limit} next_reset=${new Date((d.next_character_count_reset_unix || 0) * 1000).toISOString()} can_extend=${d.can_extend_character_limit} allowed_to_extend=${d.allowed_to_extend_character_limit} status=${d.status}`)
