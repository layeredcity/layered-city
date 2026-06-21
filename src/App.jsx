import { useState, useEffect, useCallback, useMemo, useRef, cloneElement } from 'react'
import MediaModal, { getYouTubeEmbedUrl } from './components/MediaModal'
import './App.css'
import { fetchCities, fetchStoriesForCity } from './utils/contentful'
import { fetchOmdbData } from './utils/omdb'
import MapboxMap from './components/MapboxMap'
import MiniMap from './components/MiniMap'

const QUALITY_LABELS = ['', 'Marginally interesting', 'Somewhat interesting', 'Interesting', 'Very interesting', "Ryan's pick"]

function imdbToQualityRating(imdbRating) {
  const r = parseFloat(imdbRating)
  if (isNaN(r)) return null
  if (r >= 8.0) return 5
  if (r >= 7.0) return 4
  if (r >= 6.0) return 3
  if (r >= 5.0) return 2
  return 1
}

function slugify(name) {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

const FILTERS = [
  { label: 'All',              types: ['podcast', 'video', 'movie', 'tv', 'music', 'book', 'speak', 'audiotour'] },
  { label: 'Podcast episodes', types: ['podcast'],      emptyLabel: 'podcast episodes', icon: 'podcast', unitSingular: 'episode', unitPlural: 'episodes' },
  { label: 'Short videos',     types: ['video'],        emptyLabel: 'short videos',     icon: 'video',   unitSingular: 'video',   unitPlural: 'videos' },
  { label: 'Movies & TV',      types: ['movie', 'tv'], emptyLabel: 'movies or TV',     icon: 'movie',   unitSingular: 'title',   unitPlural: 'titles' },
  { label: 'Music',            types: ['music'],        emptyLabel: 'music',            icon: 'music',   unitSingular: 'song',    unitPlural: 'songs',   alwaysShow: true },
  { label: 'Books',            types: ['book'],         emptyLabel: 'books',            icon: 'book',    unitSingular: 'book',    unitPlural: 'books',   alwaysShow: true },
  { label: 'Words',            types: ['speak'],        emptyLabel: 'words',            icon: 'words',   unitSingular: 'phrase',  unitPlural: 'phrases', alwaysShow: true },
]

const TYPE_ICONS = {
  podcast: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 48 48">
      <path fill="currentColor" fillRule="evenodd" d="M24 0.5487c12.9848 0 23.52 10.4273 23.52 23.3012v17.5028c0 2.0818 -1.3146 3.962 -3.3523 4.5346 -2.0036 0.563 -4.7785 1.2351 -7.5038 1.5393 -1.8924 0.211 -3.6091 -0.9413 -3.9324 -2.8723 -0.276 -1.6482 -0.5269 -4.1719 -0.5269 -7.9033 0 -3.7315 0.2509 -6.2552 0.5269 -7.9034 0.3233 -1.9309 2.04 -3.0833 3.9324 -2.8721 1.0752 0.1199 2.1582 0.2971 3.1984 0.5024v-2.9656c0 -8.3772 -7.0805 -15.2059 -15.8623 -15.2059S8.1377 15.0351 8.1377 23.4123v2.9656c1.0402 -0.2053 2.1232 -0.3826 3.1984 -0.5024 1.8924 -0.2112 3.6091 0.9412 3.9324 2.8721 0.276 1.6482 0.5268 4.1719 0.5268 7.9034 0 3.7314 -0.2508 6.2551 -0.5268 7.9033 -0.3233 1.931 -2.04 3.0833 -3.9324 2.8723 -2.7253 -0.3042 -5.5002 -0.9763 -7.5038 -1.5393C1.7946 45.3147 0.48 43.4345 0.48 41.3527V23.8499C0.48 10.976 11.0152 0.5487 24 0.5487Z" clipRule="evenodd"/>
    </svg>
  ),
  video: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 48 48">
      <path fill="currentColor" fillRule="evenodd" d="M19.5 37.5c5.1662 0 8.9662 -0.1722 11.5593 -0.3574 3.3014 -0.2358 5.8475 -2.7819 6.0833 -6.0833 0.1852 -2.5931 0.3574 -6.3931 0.3574 -11.5593 0 -5.1662 -0.1722 -8.9662 -0.3574 -11.55931 -0.2358 -3.30139 -2.7819 -5.8475 -6.0833 -6.08329C28.4662 1.67219 24.6662 1.5 19.5 1.5c-5.1662 0 -8.9662 0.17219 -11.55932 0.3574 -3.30138 0.2358 -5.84749 2.7819 -6.08328 6.08328C1.67219 10.5338 1.5 14.3338 1.5 19.5s0.17219 8.9662 0.3574 11.5593c0.2358 3.3014 2.7819 5.8475 6.08329 6.0833C10.5338 37.3278 14.3338 37.5 19.5 37.5Zm-6.1951 -22.6246c0.2389 -1.7315 1.7652 -2.7103 3.3907 -2.0676 1.0534 0.4166 2.4454 1.0477 4.2456 2.004 1.7074 0.9071 3.0478 1.7167 4.0802 2.3973 1.7659 1.1641 1.7659 3.4163 0 4.5805 -1.0324 0.6806 -2.3728 1.4901 -4.0802 2.3972 -1.8002 0.9564 -3.1922 1.5875 -4.2456 2.004 -1.6255 0.6428 -3.1518 -0.336 -3.3907 -2.0675 -0.1669 -1.2094 -0.3049 -2.77 -0.3049 -4.624 0 -1.8539 0.138 -3.4146 0.3049 -4.6239Zm3.6359 31.2654c-3.2146 -0.2296 -5.7132 -2.6497 -6.0599 -5.8247 2.3118 0.1063 5.1697 0.1821 8.6192 0.1821 5.2327 0 9.1041 -0.1744 11.7731 -0.3651 4.7897 -0.3421 8.5198 -4.0722 8.8619 -8.8619 0.1906 -2.6689 0.365 -6.5404 0.365 -11.773 0 -3.4495 -0.0758 -6.3074 -0.182 -8.6193 3.1749 0.3468 5.595 2.8453 5.8246 6.06 0.1852 2.5931 0.3574 6.3931 0.3574 11.5593 0 5.1662 -0.1722 8.9661 -0.3574 11.5593 -0.2358 3.3014 -2.7819 5.8475 -6.0833 6.0833 -2.5931 0.1852 -6.3931 0.3574 -11.5593 0.3574 -5.1662 0 -8.9662 -0.1722 -11.5593 -0.3574Z" clipRule="evenodd"/>
    </svg>
  ),
  movie: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 48 48">
      <path fill="currentColor" fillRule="evenodd" d="M39.8643 45.9561C36.5927 46.2219 31.4014 46.5 24 46.5c-7.4014 0 -12.5927 -0.2781 -15.8643 -0.5439 -3.28785 -0.2671 -5.82468 -2.8039 -6.09181 -6.0918C1.77808 36.5927 1.5 31.4014 1.5 24c0 -7.4014 0.27807 -12.5927 0.54389 -15.8643 0.26713 -3.28785 2.80396 -5.82467 6.09181 -6.0918C11.4073 1.77808 16.5986 1.5 24 1.5c7.4014 0 12.5927 0.27808 15.8643 0.54389 3.2878 0.26713 5.8247 2.80396 6.0918 6.09181 0.2658 3.2716 0.5439 8.4629 0.5439 15.8643 0 7.4014 -0.2781 12.5927 -0.5439 15.8643 -0.2671 3.2879 -2.804 5.8247 -6.0918 6.0918ZM24 22c-2.9807 0 -5.1316 -0.0757 -6.5549 -0.1535 -1.9632 -0.1074 -3.6092 -1.5667 -3.7844 -3.6153 -0.088 -1.03 -0.1607 -2.4266 -0.1607 -4.2312 0 -1.8046 0.0727 -3.2012 0.1608 -4.23125 0.1751 -2.0486 1.8211 -3.50789 3.7843 -3.61521C18.8684 6.07574 21.0193 6 24 6s5.1316 0.07574 6.5549 0.15355c1.9632 0.10731 3.6092 1.5666 3.7843 3.6152C34.4273 10.7988 34.5 12.1954 34.5 14c0 1.8046 -0.0727 3.2012 -0.1608 4.2313 -0.1751 2.0486 -1.8211 3.5078 -3.7843 3.6152C29.1316 21.9243 26.9807 22 24 22Zm0 20c-2.9807 0 -5.1316 -0.0757 -6.5549 -0.1535 -1.9632 -0.1074 -3.6092 -1.5667 -3.7844 -3.6153 -0.088 -1.03 -0.1607 -2.4266 -0.1607 -4.2312 0 -1.8046 0.0727 -3.2012 0.1608 -4.2312 0.1751 -2.0486 1.8211 -3.5079 3.7843 -3.6153C18.8684 26.0757 21.0193 26 24 26s5.1316 0.0757 6.5549 0.1535c1.9632 0.1074 3.6092 1.5667 3.7843 3.6153 0.0881 1.03 0.1608 2.4266 0.1608 4.2312 0 1.8046 -0.0727 3.2012 -0.1608 4.2313 -0.1751 2.0486 -1.8211 3.5078 -3.7843 3.6152C29.1316 41.9243 26.9807 42 24 42Zm17 -24.5c0.8284 0 1.5 -0.6716 1.5 -1.5s-0.6716 -1.5 -1.5 -1.5h-2c-0.8284 0 -1.5 0.6716 -1.5 1.5s0.6716 1.5 1.5 1.5h2Zm1.5 6.5c0 0.8284 -0.6716 1.5 -1.5 1.5h-2c-0.8284 0 -1.5 -0.6716 -1.5 -1.5s0.6716 -1.5 1.5 -1.5h2c0.8284 0 1.5 0.6716 1.5 1.5ZM41 33.5c0.8284 0 1.5 -0.6716 1.5 -1.5s-0.6716 -1.5 -1.5 -1.5h-2c-0.8284 0 -1.5 0.6716 -1.5 1.5s0.6716 1.5 1.5 1.5h2Zm1.5 6.5c0 0.8284 -0.6716 1.5 -1.5 1.5h-2c-0.8284 0 -1.5 -0.6716 -1.5 -1.5s0.6716 -1.5 1.5 -1.5h2c0.8284 0 1.5 0.6716 1.5 1.5ZM41 9.5c0.8284 0 1.5 -0.67157 1.5 -1.5s-0.6716 -1.5 -1.5 -1.5h-2c-0.8284 0 -1.5 0.67157 -1.5 1.5s0.6716 1.5 1.5 1.5h2ZM5.5 16c0 0.8284 0.67157 1.5 1.5 1.5h2c0.82843 0 1.5 -0.6716 1.5 -1.5s-0.67157 -1.5 -1.5 -1.5H7c-0.82843 0 -1.5 0.6716 -1.5 1.5ZM7 25.5c-0.82843 0 -1.5 -0.6716 -1.5 -1.5s0.67157 -1.5 1.5 -1.5h2c0.82843 0 1.5 0.6716 1.5 1.5s-0.67157 1.5 -1.5 1.5H7ZM5.5 32c0 0.8284 0.67157 1.5 1.5 1.5h2c0.82843 0 1.5 -0.6716 1.5 -1.5s-0.67157 -1.5 -1.5 -1.5H7c-0.82843 0 -1.5 0.6716 -1.5 1.5ZM7 41.5c-0.82843 0 -1.5 -0.6716 -1.5 -1.5s0.67157 -1.5 1.5 -1.5h2c0.82843 0 1.5 0.6716 1.5 1.5s-0.67157 1.5 -1.5 1.5H7ZM5.5 8c0 0.82843 0.67157 1.5 1.5 1.5h2c0.82843 0 1.5 -0.67157 1.5 -1.5S9.82843 6.5 9 6.5H7c-0.82843 0 -1.5 0.67157 -1.5 1.5Z" clipRule="evenodd"/>
    </svg>
  ),
  music: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 48 48">
      <path fill="currentColor" fillRule="evenodd" d="M45.5187 3.8627c0 -1.9293 -1.5643 -3.5072 -3.5263 -3.375 -4.9154 0.3314 -15.1165 1.5216 -24.8825 5.8116 -1.9194 0.8432 -3.0713 2.7731 -3.0713 4.8372v8.6489c0 0.0062 0.0001 0.0124 0.0004 0.0187v9.1341c-0.6836 -0.157 -1.3952 -0.24 -2.1256 -0.24 -5.2091 0 -9.434 4.2122 -9.434 9.4109s4.2249 9.4109 9.434 9.4109c5.209 0 9.434 -4.2122 9.434 -9.4109 0 -0.1382 -0.003 -0.2759 -0.0089 -0.4127 0.0049 -0.0281 0.0074 -0.057 0.0074 -0.0866V17.6066c6.6525 -2.3284 12.5931 -3.4611 16.8603 -4.0115v10.0862c-0.6735 -0.1532 -1.374 -0.2339 -2.093 -0.2339 -5.1958 0 -9.4075 4.2136 -9.4075 9.4109s4.2117 9.4109 9.4075 9.4109c5.1957 0 9.4074 -4.2137 9.4074 -9.4109 0 -0.1492 -0.0035 -0.2976 -0.0103 -0.4451 0.0019 -0.0179 0.0028 -0.0359 0.0028 -0.0542V12.6501c0.0037 -0.0245 0.0056 -0.0493 0.0056 -0.0744v-8.713Z" clipRule="evenodd"/>
    </svg>
  ),
  book: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 48 48">
      <path fill="currentColor" fillRule="evenodd" d="M6.35236 3.57823c-2.68852 -0.13189 -5.00134 1.81199 -5.27719 4.51505C0.799341 10.7962 0.5 15.1843 0.5 21.5c0 6.3156 0.299341 10.7038 0.57517 13.4067 0.27952 2.7389 2.59519 4.5436 5.13019 4.668 6.79884 0.3335 11.22094 1.7771 16.18724 4.2853 0.0356 0.0179 0.0714 0.0353 0.1074 0.052l0 -36.34179c-4.8252 -2.30208 -9.4516 -3.6635 -16.14764 -3.99198ZM16.1725 16.2616c0.765 0.374 1.6914 0.2803 2.1418 -0.5387 0.4188 -0.7615 0.0784 -1.69 -0.665 -2.0764 -0.272 -0.1413 -1.2434 -0.6173 -2.8407 -1.0859C12.9827 12.025 10.3403 11.5 7 11.5c-0.82843 0 -1.5 0.6716 -1.5 1.5s0.67157 1.5 1.5 1.5c3.0234 0 5.381 0.475 6.9642 0.9394 1.1877 0.3484 1.9402 0.6911 2.2083 0.8222Zm0 9c0.765 0.374 1.6914 0.2803 2.1418 -0.5387 0.419 -0.7619 0.0792 -1.6896 -0.665 -2.0764 -0.8987 -0.467 -1.872 -0.8017 -2.8407 -1.0859C12.9827 21.025 10.3403 20.5 7 20.5c-0.82843 0 -1.5 0.6716 -1.5 1.5s0.67157 1.5 1.5 1.5c3.0234 0 5.381 0.475 6.9642 0.9394 1.1877 0.3484 1.9402 0.6911 2.2083 0.8222Zm0 9c0.765 0.374 1.6914 0.2803 2.1418 -0.5387 0.4191 -0.7619 0.0789 -1.6897 -0.665 -2.0764 -0.8987 -0.467 -1.872 -0.8017 -2.8407 -1.0859C12.9827 30.025 10.3403 29.5 7 29.5c-0.82843 0 -1.5 0.6716 -1.5 1.5s0.67157 1.5 1.5 1.5c3.0234 0 5.381 0.475 6.9642 0.9394 1.1877 0.3484 1.9402 0.6911 2.2083 0.8222Zm9.4349 9.5984c-0.0356 0.0179 -0.0714 0.0353 -0.1074 0.052l0 -36.34179c4.8252 -2.30208 9.4516 -3.6635 16.1476 -3.99198 2.6886 -0.13189 5.0014 1.81199 5.2772 4.51505C47.2007 10.7962 47.5 15.1843 47.5 21.5c0 6.3156 -0.2993 10.7038 -0.5752 13.4067 -0.2795 2.7389 -2.5952 4.5436 -5.1302 4.668 -6.7988 0.3335 -11.2209 1.7771 -16.1872 4.2853Zm7.584 -31.2994c-1.5973 0.4686 -2.5687 0.9446 -2.8407 1.0859 -0.7434 0.3864 -1.0838 1.3149 -0.665 2.0764 0.4046 0.7357 1.3203 0.967 2.0484 0.5856 0.1226 -0.0637 0.9161 -0.4627 2.3017 -0.8691C35.619 14.975 37.9766 14.5 41 14.5c0.8284 0 1.5 -0.6716 1.5 -1.5s-0.6716 -1.5 -1.5 -1.5c-3.3403 0 -5.9827 0.525 -7.8086 1.0606Zm0 9c-1.5973 0.4686 -2.5687 0.9446 -2.8407 1.0859 -0.7428 0.3887 -1.0849 1.3129 -0.665 2.0764 0.4504 0.819 1.3768 0.9127 2.1418 0.5387 0.2681 -0.1311 1.0206 -0.4738 2.2083 -0.8222C35.619 23.975 37.9766 23.5 41 23.5c0.8284 0 1.5 -0.6716 1.5 -1.5s-0.6716 -1.5 -1.5 -1.5c-3.3403 0 -5.9827 0.525 -7.8086 1.0606Zm5.7974 9.4665c0.101 0.8222 -0.4837 1.5707 -1.3059 1.6717 -1.9732 0.2424 -3.4944 0.6633 -4.5074 1.0155 -0.7597 0.2641 -1.2332 0.4894 -1.3954 0.5707 -0.7483 0.3752 -1.6656 0.2174 -2.0944 -0.5622 -0.4124 -0.7497 -0.0928 -1.6737 0.6433 -2.065 0.5948 -0.3127 1.2279 -0.5569 1.8614 -0.7772 1.1923 -0.4145 2.9211 -0.8885 5.1267 -1.1594 0.8223 -0.1011 1.5707 0.4836 1.6717 1.3059Z" clipRule="evenodd"/>
    </svg>
  ),
  words: (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 48 48">
      <path fill="currentColor" fillRule="evenodd" d="M0.5 24C0.5 11.0213 11.0213 0.5 24 0.5S47.5 11.0213 47.5 24 36.9787 47.5 24 47.5c-4.2754 0 -8.2855 -1.1422 -11.7402 -3.1383 -2.61565 0.966 -5.58424 1.9153 -8.50237 2.5914 -1.65828 0.3842 -3.142885 -1.0357 -2.810348 -2.7125 0.605368 -3.0525 1.543198 -6.114 2.543168 -8.7605C1.58577 32.0848 0.5 28.1685 0.5 24Zm35 -4.5c0 -0.4242 -0.0124 -0.7846 -0.0314 -1.0877 -0.0655 -1.0481 -0.8988 -1.7412 -1.8858 -1.7837C32.2121 16.5694 29.445 16.5 24 16.5c-5.4449 0 -8.2121 0.0694 -9.5828 0.1286 -0.987 0.0425 -1.8203 0.7356 -1.8858 1.7837 -0.019 0.3031 -0.0314 0.6635 -0.0314 1.0877 0 0.4242 0.0124 0.7846 0.0314 1.0877 0.0655 1.0481 0.8988 1.7412 1.8858 1.7837 1.3707 0.0592 4.1378 0.1286 9.5828 0.1286 5.4635 0 8.2313 -0.0727 9.5975 -0.1343 0.9797 -0.0443 1.805 -0.7322 1.8707 -1.7724 0.0192 -0.3038 0.0318 -0.6659 0.0318 -1.0933Zm-8 11c0 -0.4015 -0.0071 -0.7446 -0.0181 -1.0351 -0.0396 -1.0464 -0.8239 -1.8116 -1.8552 -1.8646C24.6316 27.5492 22.9174 27.5 20 27.5c-2.9174 0 -4.6316 0.0492 -5.6267 0.1003 -1.0313 0.053 -1.8156 0.8182 -1.8552 1.8646 -0.011 0.2905 -0.0181 0.6336 -0.0181 1.0351 0 0.4015 0.0071 0.7446 0.0181 1.0351 0.0396 1.0464 0.8239 1.8116 1.8552 1.8646 0.9951 0.0511 2.7093 0.1003 5.6267 0.1003 2.934 0 4.6515 -0.0517 5.6445 -0.1052 1.0229 -0.0551 1.7972 -0.8148 1.837 -1.8515 0.0112 -0.2917 0.0185 -0.6375 0.0185 -1.0433Z" clipRule="evenodd"/>
    </svg>
  ),
}

function CityOverview({ city, stories, storiesLoading, onSelectFilter }) {
  if (storiesLoading) {
    return (
      <div style={{padding:'40px',textAlign:'center',color:'var(--ink-light)',fontStyle:'italic',fontFamily:'var(--font-display)',fontSize:'17px'}}>
        Loading...
      </div>
    )
  }
  const sections = FILTERS.slice(1)
    .map(f => ({ filter: f, count: stories.filter(s => f.types.includes((s.mediaType || '').toLowerCase())).length }))
    .filter(({ filter, count }) => count > 0 || filter.alwaysShow)
  return (
    <div className="city-overview">
      {sections.map(({ filter, count }) => (
        <div key={filter.label} className="overview-item" onClick={() => onSelectFilter(filter.label)}>
          <div className="overview-item__icon-wrap">{TYPE_ICONS[filter.icon]}</div>
          <div className="overview-item__body">
            <div className="overview-item__label">{filter.label}</div>
            <div className="overview-item__count">{count === 0 ? 'Coming soon' : count + ' ' + (count === 1 ? filter.unitSingular : filter.unitPlural)}</div>
          </div>
          <svg className="overview-item__arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M9 18l6-6-6-6"/></svg>
        </div>
      ))}
      {city.quote && (
        <div className="city-quote">
          <div className="city-quote__text">“{city.quote}”</div>
          {city.quoteAttribution && (
            <div className="city-quote__attribution">{city.quoteAttribution}</div>
          )}
        </div>
      )}
    </div>
  )
}

function mediaTypeLabel(type) {
  if (!type) return 'Story'
  const t = type.toLowerCase()
  if (t === 'podcast') return 'Podcast'
  if (t === 'video') return 'Video'
  if (t === 'audiotour') return 'Audio tour'
  if (t === 'movie') return 'Movie'
  if (t === 'tv') return 'TV'
  if (t === 'book') return 'Book'
  return type
}

function iconShape(type) {
  if (!type) return 'podcast'
  return type.toLowerCase() === 'video' ? 'video' : 'podcast'
}

function movieBtnLabel(url) {
  if (!url) return 'Rent or buy'
  try {
    const host = new URL(url).hostname.replace('www.', '')
    if (host.includes('amazon') || host.includes('primevideo')) return 'Rent or buy on Amazon'
    if (host.includes('apple') || host.includes('tv.apple')) return 'Rent or buy on Apple TV'
    if (host.includes('vimeo')) return 'Watch on Vimeo'
    if (host.includes('youtube') || host.includes('youtu.be')) return 'Watch on YouTube'
  } catch {}
  return 'Rent or buy'
}

function formatDuration(minutes, seconds) {
  if (!minutes && !seconds) return null
  const m = minutes || 0
  const s = seconds || 0
  if (m >= 60) {
    const h = Math.floor(m / 60)
    const rem = m % 60
    return rem > 0 ? h + 'h ' + rem + 'm' : h + 'h'
  }
  if (s > 0) return m + 'm ' + s + 's'
  return m + 'm'
}

function QualityStars({ rating, max = 5 }) {
  if (!rating) return null
  return (
    <div className="quality-stars">
      {Array.from({ length: max }).map((_, i) => (
        <svg key={i} className={"quality-star" + (i < rating ? " quality-star--filled" : "")} viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 2.5l2.6 5.3 5.9.9-4.3 4.1 1 5.9-5.2-2.7-5.2 2.7 1-5.9-4.3-4.1 5.9-.9z" strokeLinejoin="round" strokeLinecap="round"/>
        </svg>
      ))}
    </div>
  )
}

function StoryIcon({ story, omdbData }) {
  const shape = iconShape(story.mediaType)
  const label = mediaTypeLabel(story.mediaType)
  const poster = omdbData?.poster
  if (story.channelIcon || poster) {
    const isMoviePoster = poster && !story.channelIcon
    const src = story.channelIcon ? story.channelIcon + '?w=112&h=112&fit=fill' : poster
    return (
      <img
        className={isMoviePoster ? 'story-item__icon-poster' : 'story-item__icon-' + shape}
        src={src}
        alt={story.channelName || story.title}
      />
    )
  }
  return (
    <div
      className="story-item__icon--placeholder"
      style={{borderRadius: shape === 'video' ? '50%' : '14px'}}
    >
      {label.slice(0,3).toUpperCase()}
    </div>
  )
}

function StoryModal({ story, onClose, onOpenMedia, omdbData }) {
  if (!story) return null
  const label = mediaTypeLabel(story.mediaType)
  const duration = formatDuration(story.minutes, story.seconds)
  const effectiveRating = story.qualityRating || imdbToQualityRating(omdbData?.rating)
  const qualityLabel = QUALITY_LABELS[effectiveRating] || null
  const url = story.mediaUrl || story.secondaryUrl || null
  const t = story.mediaType?.toLowerCase()
  const isMovieOrTV = t === 'movie' || t === 'tv'
  const isVideo = t === 'video' || t === 'movie' || t === 'tv'
  const hasMedia = url && (isVideo || t === 'podcast' || t === 'audiotour')
  const btnLabel = (t === 'movie' || t === 'tv') ? movieBtnLabel(url) : t === 'audiotour' ? 'Listen to the audio tour' : t === 'podcast' ? 'Listen to the episode' : 'Watch the video'
  return (
    <div className="story-modal-overlay" onClick={onClose}>
      <div className="story-modal" onClick={e => e.stopPropagation()}>
        <button className="story-modal__close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" strokeLinecap="round"/></svg>
        </button>
        <div className="story-modal__header">
          <StoryIcon story={story} omdbData={omdbData} />
          <div className="story-modal__header-text">
            <div className="story-modal__type">
              {label}
              {story.releaseYear && <span className="story-modal__year"> · {story.releaseYear}</span>}
              {story.season && story.episode && <span className="story-modal__year"> · S{story.season} E{story.episode}</span>}
            </div>
            {story.creatorName && <div className="story-modal__channel">{t === 'movie' || t === 'tv' ? 'Directed by' : 'By'} {story.creatorName}</div>}
            {story.channelName && <div className="story-modal__channel">from {story.channelName}</div>}
            {!isMovieOrTV && omdbData?.rating && (
              <div className="story-modal__imdb">
                <svg viewBox="0 0 24 24" fill="#f5c518" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                <span className="story-modal__imdb-label">IMDb rating</span>
                {omdbData.rating}<span className="story-modal__imdb-max">/10</span>
              </div>
            )}
          </div>
        </div>
        <h2 className="story-modal__title">{story.title}</h2>
        {story.description && (
          <>
            <div className="story-modal__why">
              {isVideo ? 'Why watch?' : t === 'audiotour' ? 'Why walk it?' : 'Why listen?'}
            </div>
            <p className="story-modal__desc">{story.description}</p>
          </>
        )}
        <div className="story-modal__meta">
          {isMovieOrTV ? (
            omdbData?.rating && (
              <div className="story-modal__imdb">
                <svg viewBox="0 0 24 24" fill="#f5c518" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                <span className="story-modal__imdb-label">IMDb rating</span>
                {omdbData.rating}<span className="story-modal__imdb-max">/10</span>
              </div>
            )
          ) : (
            <>
              <QualityStars rating={effectiveRating} />
              {qualityLabel && <span className="story-modal__quality-label">{qualityLabel}</span>}
            </>
          )}
          {duration && <span className="story-modal__duration">{duration}</span>}
        </div>
        {hasMedia && (
          t === 'video' ? (
            <button className="story-modal__btn" onClick={() => onOpenMedia(story)}>
              <svg viewBox="0 0 24 24" fill="currentColor" className="story-modal__btn-icon"><polygon points="5,3 19,12 5,21"/></svg>
              {btnLabel}
            </button>
          ) : (
            <a href={url} target="_blank" rel="noreferrer" className="story-modal__btn">
              {isMovieOrTV
                ? cloneElement(TYPE_ICONS.movie, { className: 'story-modal__btn-icon' })
                : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="story-modal__btn-icon"><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/></svg>
              }
              {btnLabel}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="story-modal__btn-icon"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round"/></svg>
            </a>
          )
        )}
      </div>
    </div>
  )
}

function StoryItem({ story, onSelect, omdbData }) {
  const duration = formatDuration(story.minutes, story.seconds)
  const label = mediaTypeLabel(story.mediaType)
  const t = (story.mediaType || '').toLowerCase()
  const isMovieOrTV = t === 'movie' || t === 'tv'
  const effectiveRating = story.qualityRating || imdbToQualityRating(omdbData?.rating)
  return (
    <div className="story-item" onClick={() => onSelect(story)} style={{cursor: 'pointer'}}>
      <StoryIcon story={story} omdbData={omdbData} />
      <div className="story-item__body">
        <div className="story-item__title">{story.title}</div>
        <div className="story-item__meta">
          <span className="story-item__type">{label}</span>
          {story.releaseYear && <span className="story-item__source"> · {story.releaseYear}</span>}
          {story.creatorName && (
            <span className="story-item__source"> · {story.creatorName}</span>
          )}
          {story.channelName && (
            <span className="story-item__source"> from {story.channelName}</span>
          )}
          {duration && (
            <span className="story-item__source"> · {duration}</span>
          )}
        </div>
        {omdbData?.rating && (
          <div className="story-item__imdb">
            <svg viewBox="0 0 24 24" fill="#f5c518" width="12" height="12"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
            <span className="story-item__imdb-label">IMDb rating</span>
            {omdbData.rating}<span className="story-item__imdb-max">/10</span>
          </div>
        )}
        {!isMovieOrTV && <QualityStars rating={effectiveRating} />}
      </div>
    </div>
  )
}

export default function App() {
  const [cities, setCities] = useState([])
  const [storyCounts, setStoryCounts] = useState({})
  const [selectedCity, setSelectedCity] = useState(null)
  const [stories, setStories] = useState([])
  const [storiesLoading, setStoriesLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [activeFilter, setActiveFilter] = useState('All')
  const [detailView, setDetailView] = useState('overview')
  const [mobileView, setMobileView] = useState('list')
  const [selectedStory, setSelectedStory] = useState(null)
  const [mediaStory, setMediaStory] = useState(null)
  const [omdbCache, setOmdbCache] = useState({})
  const modalAnchorRef = useRef(null)

  // iOS PWA: force app to fill the physical screen height
  useEffect(() => {
    const setScreenHeight = () => {
      document.documentElement.style.setProperty('--screen-h', window.screen.height + 'px')
    }
    setScreenHeight()
    window.addEventListener('orientationchange', () => setTimeout(setScreenHeight, 100))
  }, [])

  const omdbData = selectedStory?.imdbId ? (omdbCache[selectedStory.imdbId] ?? null) : null

  const closeStoryWithFade = useCallback(() => {
    if (modalAnchorRef.current) {
      modalAnchorRef.current.style.transition = 'opacity 0.2s ease'
      modalAnchorRef.current.style.opacity = '0'
    }
    setTimeout(() => setSelectedStory(null), 200)
  }, [])

  const selectCity = useCallback(async (city) => {
    closeStoryWithFade()
    setSelectedCity(city)
    setActiveFilter('All')
    setDetailView('overview')
    setMobileView('detail')
    setStoriesLoading(true)
    window.history.pushState({}, '', '/' + slugify(city.name))
    try {
      const data = await fetchStoriesForCity(city.id)
      setStories(data)
      setStoryCounts(prev => ({ ...prev, [city.id]: data.length }))
      data.filter(s => s.imdbId).forEach(s => {
        fetchOmdbData(s.imdbId).then(omdb => {
          if (omdb) setOmdbCache(prev => ({ ...prev, [s.imdbId]: omdb }))
        })
      })
    } catch (err) {
      console.error('Failed to fetch stories:', err)
      setStories([])
    } finally {
      setStoriesLoading(false)
    }
  }, [closeStoryWithFade])

  const goHome = useCallback(() => {
    closeStoryWithFade()
    setSelectedCity(null)
    setStories([])
    setDetailView('overview')
    setActiveFilter('All')
    setMobileView('list')
    window.history.pushState({}, '', '/')
  }, [closeStoryWithFade])

  useEffect(() => {
    fetchCities().then(async data => {
      setCities(data)
      setLoading(false)

      // Auto-select city from URL on initial load
      const slug = window.location.pathname.replace(/^\//, '').toLowerCase()
      if (slug) {
        const match = data.find(c => slugify(c.name) === slug)
        if (match) selectCity(match)
      }

      const counts = {}
      await Promise.all(data.map(async city => {
        try {
          const stories = await fetchStoriesForCity(city.id)
          counts[city.id] = stories.length
          setStoryCounts(prev => ({ ...prev, [city.id]: stories.length }))
        } catch (e) {
          counts[city.id] = 0
        }
      }))
    }).catch(err => {
      console.error('Failed to fetch cities:', err)
      setLoading(false)
    })
  }, [])

  // Handle browser back/forward
  useEffect(() => {
    const onPopState = () => {
      const slug = window.location.pathname.replace(/^\//, '').toLowerCase()
      setCities(prev => {
        if (!slug) {
          setSelectedCity(null)
          setStories([])
          setDetailView('overview')
          setActiveFilter('All')
          setMobileView('list')
        } else {
          const match = prev.find(c => slugify(c.name) === slug)
          if (match) selectCity(match)
        }
        return prev
      })
    }
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [selectCity])

  const currentFilter = FILTERS.find(f => f.label === activeFilter) || FILTERS[0]

  const effectiveRatingForStory = useCallback((s) => {
    const t = (s.mediaType || '').toLowerCase()
    if (t === 'movie' || t === 'tv') return imdbToQualityRating(omdbCache[s.imdbId]?.rating) || 0
    return s.qualityRating || 0
  }, [omdbCache])

  const filteredStories = useMemo(() =>
    stories
      .filter(s => currentFilter.types.includes((s.mediaType || '').toLowerCase()))
      .sort((a, b) => effectiveRatingForStory(b) - effectiveRatingForStory(a)),
    [stories, currentFilter, effectiveRatingForStory]
  )

  const mapStories = detailView === 'overview' ? stories : filteredStories

  if (loading) {
    return (
      <div className="loading-screen">
        <img className="loading-screen__logo" src="/logo.png" alt="Layered City" />
        <p>Loading cities...</p>
      </div>
    )
  }

  return (
    <div className={"app" + (selectedCity ? ' app--city-selected' : '')}>
      <aside className={"panel-cities" + (mobileView === 'detail' ? ' panel-cities--hidden' : '')}>
        <div className="panel-cities__header">
          <div className="logo" onClick={goHome} style={{cursor:'pointer'}}>
            <img className="logo__img" src="/logo.png" alt="Layered City" />
            <div className="logo__text-block">
              <div className="logo__title">The guidebook companion for curious travelers in Europe</div>
              <div className="logo__sub">Curated and written by Ryan Nee</div>
            </div>
          </div>
        </div>
        <div className="panel-cities__scroll">
          {cities.map(city => (
            <div
              key={city.id}
              className={"city-item" + (selectedCity && selectedCity.id === city.id ? ' city-item--active' : '')}
              onClick={() => selectCity(city)}
            >
              <div className="city-item__info">
                <div className="city-item__name">{city.name}</div>
                <div className="city-item__country">{city.country}</div>
              </div>
              {city.heroImage
                ? <img className="city-item__thumb" src={city.heroImage + '?w=128&h=128&fit=fill'} alt={city.name} />
                : <div className="city-item__thumb city-item__thumb--placeholder">?</div>
              }
            </div>
          ))}
        </div>
      </aside>

      <section className={"panel-detail" + (selectedCity ? ' panel-detail--open' : '')}>
        {mobileView === 'detail' && selectedCity && (
          <div className="mobile-back" onClick={() => {
            if (detailView === 'stories') { closeStoryWithFade(); setDetailView('overview'); setActiveFilter('All') }
            else goHome()
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            {detailView === 'stories' ? selectedCity.name : 'All cities'}
          </div>
        )}
        {selectedCity && (
          <div style={{display:'flex',flexDirection:'column',position:'absolute',top:0,left:0,right:0,bottom:0,overflow:'hidden'}}>
            <div className="city-hero">
              {selectedCity.heroImage
                ? <img className="city-hero__img" src={selectedCity.heroImage + '?w=840&h=560&fit=fill'} alt={selectedCity.name} />
                : <div className="city-hero__img" style={{background:'var(--border)'}} />
              }
              <div className="city-hero__overlay" />
              <div className="city-hero__text">
                <div className="city-hero__name">{selectedCity.name}</div>
                <div className="city-hero__country">{selectedCity.country}</div>
              </div>
            </div>
            <div className={"nav-slide-track" + (detailView === 'stories' ? ' nav-slide-track--stories' : '')}>
              <div className="nav-slide-panel">
                <CityOverview
                  city={selectedCity}
                  stories={stories}
                  storiesLoading={storiesLoading}
                  onSelectFilter={f => { setActiveFilter(f); setDetailView('stories') }}
                />
              </div>
              <div className="nav-slide-panel">
                <div className="overview-back" onClick={() => { closeStoryWithFade(); setDetailView('overview'); setActiveFilter('All') }}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M15 18l-6-6 6-6"/></svg>
                  All categories
                </div>
                <div className="stories-header">
                  <div className="stories-header__title">{currentFilter.label}</div>
                </div>
                <div className="stories-scroll">
                  {storiesLoading ? (
                    <div style={{padding:'40px',textAlign:'center',color:'var(--ink-light)',fontStyle:'italic',fontFamily:'var(--font-display)',fontSize:'17px'}}>Loading stories...</div>
                  ) : filteredStories.length === 0 ? (
                    <div style={{padding:'40px',textAlign:'center',color:'var(--ink-xlight)',fontFamily:'var(--font-display)',fontStyle:'italic',fontSize:'17px'}}>
                      Layered City does not yet have any {currentFilter.emptyLabel} about {selectedCity.name}.
                    </div>
                  ) : (
                    [5, 4, 3, 2, 1, 0].flatMap(rating => {
                      const group = filteredStories.filter(s => effectiveRatingForStory(s) === rating)
                      if (!group.length) return []
                      const label = rating === 0 ? null : rating === 5 && group.length > 1 ? "Ryan's picks" : QUALITY_LABELS[rating]
                      return [
                        label ? <div key={'heading-' + rating} className="story-group-heading">{label}</div> : null,
                        ...group.map(story => <StoryItem key={story.id} story={story} onSelect={setSelectedStory} omdbData={omdbCache[story.imdbId]} />)
                      ].filter(Boolean)
                    })
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      <div className="panel-map">
        <MapboxMap
          city={selectedCity}
          cities={cities}
          allStories={stories}
          stories={mapStories}
          omdbCache={omdbCache}
          onCityClick={selectCity}
          focusStory={selectedStory}
          onStoryClick={setSelectedStory}
          onStoryPin={pos => {
            if (modalAnchorRef.current) {
              modalAnchorRef.current.style.left = (pos?.x ?? -9999) + 'px'
              modalAnchorRef.current.style.top  = (pos?.y ?? -9999) + 'px'
            }
          }}
        />
        {selectedStory && (
          <div ref={modalAnchorRef} className="story-modal-anchor">
            <StoryModal story={selectedStory} onClose={() => setSelectedStory(null)} onOpenMedia={setMediaStory} omdbData={omdbData} />
            <div className="story-modal-arrow" />
          </div>
        )}
        <MediaModal story={mediaStory} onClose={() => setMediaStory(null)} />
      </div>

      {/* Mobile story detail panel */}
      <div className={"panel-story" + (selectedStory ? ' panel-story--open' : '')}>
        {selectedStory && (() => {
          const s = selectedStory
          const label = mediaTypeLabel(s.mediaType)
          const duration = formatDuration(s.minutes, s.seconds)
          const qualityLabel = QUALITY_LABELS[s.qualityRating] || null
          const url = s.mediaUrl || s.secondaryUrl || null
          const t = s.mediaType?.toLowerCase()
          const isVideo = ['video', 'movie', 'tv'].includes(t)
          const whyLabel = isVideo ? 'Why watch?' : t === 'audiotour' ? 'Why walk it?' : t === 'book' ? 'Why read it?' : 'Why listen?'
          const btnLabel = isVideo ? 'Watch the video' : t === 'audiotour' ? 'Listen to the audio tour' : 'Listen to the episode'
          const hasMedia = url && (isVideo || t === 'podcast' || t === 'audiotour')
          return (
            <>
              <div className="mobile-back" onClick={() => setSelectedStory(null)}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
                Back
              </div>
              <div className="panel-story__scroll">
                <div className="panel-story__content">
                  <div className="story-modal__header">
                    <StoryIcon story={s} omdbData={omdbData} />
                    <div className="story-modal__header-text">
                      <div className="story-modal__type">
                        {label}
                        {s.releaseYear && <span className="story-modal__year"> · {s.releaseYear}</span>}
                        {s.season && s.episode && <span className="story-modal__year"> · S{s.season} E{s.episode}</span>}
                      </div>
                      {s.creatorName && <div className="story-modal__channel">{(s.mediaType||'').toLowerCase() === 'movie' || (s.mediaType||'').toLowerCase() === 'tv' ? 'Directed by' : 'By'} {s.creatorName}</div>}
                      {s.channelName && <div className="story-modal__channel">from {s.channelName}</div>}
                      {omdbData?.rating && (
                        <div className="story-modal__imdb">
                          <svg viewBox="0 0 24 24" fill="#f5c518" width="14" height="14"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg>
                          <span className="story-modal__imdb-label">IMDb rating</span>
                          {omdbData.rating}<span className="story-modal__imdb-max">/10</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <h2 className="story-modal__title">{s.title}</h2>
                  {s.description && (
                    <>
                      <div className="story-modal__why">{whyLabel}</div>
                      <p className="story-modal__desc">{s.description}</p>
                    </>
                  )}
                  <div className="story-modal__meta">
                    <QualityStars rating={s.qualityRating} />
                    {qualityLabel && <span className="story-modal__quality-label">{qualityLabel}</span>}
                    {duration && <span className="story-modal__duration">{duration}</span>}
                  </div>
                  {hasMedia && (
                    <a href={url} target="_blank" rel="noreferrer" className="story-modal__btn">
                      {isVideo
                        ? <svg viewBox="0 0 24 24" fill="currentColor" className="story-modal__btn-icon"><polygon points="5,3 19,12 5,21"/></svg>
                        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="story-modal__btn-icon"><path d="M3 18v-6a9 9 0 0118 0v6"/><path d="M21 19a2 2 0 01-2 2h-1a2 2 0 01-2-2v-3a2 2 0 012-2h3zM3 19a2 2 0 002 2h1a2 2 0 002-2v-3a2 2 0 00-2-2H3z"/></svg>
                      }
                      {btnLabel}
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="story-modal__btn-icon"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    </a>
                  )}
                </div>
                <MiniMap story={s} />
              </div>
            </>
          )
        })()}
      </div>
    </div>
  )
}
