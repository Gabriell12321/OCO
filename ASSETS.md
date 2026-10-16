# Photographic material sources

All surface photograph sets below were downloaded from [Poly Haven](https://polyhaven.com/) on 15 October 2026. They are released by their authors under [CC0](https://polyhaven.com/license), permitting modification and redistribution. They are bundled locally; the running room does not request Poly Haven or a texture CDN.

| Surface | Original photographic texture | Bundled maps |
| --- | --- | --- |
| Floor | [Old Wood Floor](https://polyhaven.com/a/old_wood_floor) | 2k diffuse JPEG; 1k OpenGL normal and roughness JPEG |
| Walls, ceiling, painted trim | [White Plaster 02](https://polyhaven.com/a/white_plaster_02) | 2k diffuse and OpenGL normal; 1k roughness JPEG |
| Walnut furniture | [Dark Wood](https://polyhaven.com/a/dark_wood) | 2k diffuse and OpenGL normal; 1k roughness JPEG |
| Linen, duvet, curtains, lampshade | [Rough Linen](https://polyhaven.com/a/rough_linen) | 2k diffuse and OpenGL normal; 1k roughness JPEG |
| Rug | [Dirty Carpet](https://polyhaven.com/a/dirty_carpet) | 1k diffuse, OpenGL normal and roughness JPEG |

Downloads use the file URLs provided by `https://api.polyhaven.com/files/{asset_id}`. Every bundled photographic surface file was checked against the MD5 supplied by that API, including the six new 2k maps. Original downloaded images are unmodified. `materials.js` prepares neutral ivory and tobacco fabric maps from the photographed blue linen's linear luminance using canvas at load time. Subtle deterministic paint patina is similarly baked into a runtime canvas copy of the plaster map. Surface colour multipliers adapt the palette to the room. The rug's geometric ornament is drawn in code and combined with the photographic dirty-carpet weave. The lamp's warm transmission gradient and pleats are prepared in a small emissive texture at load time. No AI generated texture is used.

Diffuse maps use sRGB. Normal and roughness maps use linear data. Painted architecture and timber use real-world UV scale so the photographed grain remains consistent on narrow mouldings and furniture panels. The wood's scanned roughness preserves variation in worn varnish. All material detail is rendered on actual room geometry. Runtime texture anisotropy is limited to four. The bundled surface photographs, including the retained earlier 1k versions, total approximately 32.5 MB.

## Iluminação de ambiente

O HDRI `assets/moonlit_room_1k.hdr` vem de [Rogland Moonlit Night, Poly Haven](https://polyhaven.com/a/rogland_moonlit_night), sob CC0. O arquivo equiretangular de 1k é incluído localmente e alimenta tanto o ambiente físico quanto a vista pela janela. A renderização não solicita a API do Poly Haven durante o uso.

## Chuva e áudio da versão 0.8.0

A chuva e as gotas no vidro são desenhadas por geometria instanciada e
shaders próprios em `dist/weather/rain.js`. Não usam fotografias, vídeos ou
sprites externos. Os sons de chuva, pingos e falhas elétricas são sintetizados
localmente por `dist/audio/room-audio.js`, com ruído determinístico, osciladores
e envelopes. Não há gravações de terceiros, downloads de áudio ou requisições
de rede durante a reprodução.

## Gravações de chuva e trovão da versão 0.9.0

Gravações naturais substituem a camada principal de chuva sintetizada e
fornecem o trovão. Ambas são distribuídas pelos autores sob
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/). As páginas e
licenças foram conferidas em 16 de outubro de 2026. Os MP3 de prévia em alta
qualidade disponibilizados publicamente pelo Freesound são incluídos localmente,
sem alterações no arquivo. A reprodução não depende de internet ou de conta.

| Arquivo local | Gravação e autor | Fonte do arquivo | Bytes |
| --- | --- | --- | ---: |
| `dist/assets/audio/rain-window.mp3` | [rain - outside window.wav — Anthousai](https://freesound.org/people/Anthousai/sounds/398741/) | [MP3 HQ](https://cdn.freesound.org/previews/398/398741_5923045-hq.mp3) | 558000 |
| `dist/assets/audio/distant-thunder.mp3` | [Distant Thunder 3 — Fission9](https://freesound.org/people/Fission9/sounds/581124/) | [MP3 HQ](https://cdn.freesound.org/previews/581/581124_9395330-hq.mp3) | 193200 |

SHA-256 dos arquivos distribuídos:

- Chuva: `7345cb8a095163b7188e074160fac0c7b9ca72a534025a97bdb589a6b9ff943d`.
- Trovão: `8036733e48a347e0a36d249f4b783dafaf09d7a69ab3962f43e51ac8c0af796c`.

O módulo de áudio prepara a transição do loop, níveis e filtros em memória.
Pingos suplementares e estalos elétricos continuam sendo efeitos próprios.
Se uma gravação não puder ser lida ou decodificada, existe uma alternativa
procedural local; o diagnóstico informa qual fonte foi efetivamente utilizada.
