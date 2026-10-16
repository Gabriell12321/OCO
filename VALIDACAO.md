# Validação da versão 0.7.0

Aplicativo Windows na Intel Iris Xe (D3D11/ANGLE), janela de 1900 × 977,
perfil Desempenho, resolução interna fixa de 1004 × 516 e FXAA. Comparação
com o aplicativo 0.6.1 preservado antes da alteração, usando as mesmas poses
e o mesmo percurso de câmera. A resolução adaptativa ficou bloqueada na
versão nova; a telemetria confirma o mesmo tamanho de imagem nas duas versões.

Cada vista da cama foi medida por cinco segundos, após aquecimento. A vista
direita fica imóvel; as outras fazem o mesmo giro suave. O tempo de GPU vem
das consultas assíncronas já existentes, com cerca de vinte amostras por vista.

| Vista | FPS 0.6.1 | FPS 0.7.0 | Quadro p95 antes → depois | GPU média antes → depois |
| --- | ---: | ---: | ---: | ---: |
| Lado direito | 55,04 | 59,97 | 33,2 → 16,8 ms | 13,98 → 9,54 ms |
| Pés da cama | 59,08 | 60,03 | 17,0 → 16,8 ms | 14,61 → 9,01 ms |
| Lado esquerdo | 56,94 | 60,04 | 32,8 → 16,9 ms | 15,32 → 9,48 ms |
| Cobertor de perto | 59,02 | 59,99 | 16,9 → 16,9 ms | 11,51 → 9,32 ms |

A vista inicial de controle foi excluída da comparação porque recebeu input
físico durante a execução anterior; as quatro vistas da cama tiveram poses
verificadas. O diagnóstico agora ignora input físico somente na janela de
teste, mantendo os comandos sintéticos e o funcionamento normal do jogo.
Os resultados são amostras curtas nesta máquina, limitadas pela apresentação
a 60 Hz; não representam garantia de FPS em qualquer ambiente.

O percurso de aproximadamente 35 segundos incluiu caminhada, corrida e
movimento do mouse pelo controlador real. Nos 25 segundos de movimento:

| Medida | Resultado |
| --- | ---: |
| FPS renderizados | 60,01 |
| Tempo de quadro médio | 16,67 ms |
| Tempo de quadro p95 / p99 | 16,8 / 17,0 ms |
| CPU média | 3,20 ms |

A sombra humana ligada/desligada produziu imagens idênticas nos três lados
da cama, como esperado quando o jogador está além dela em relação à luz.
Na parede, escureceu 203.167 pixels sem clarear nenhum. O deslocamento de
0,901 metro junto à cama teve atraso espacial máximo de 1,86 cm; o retorno
à parede passou. Não houve partículas nem erros no percurso.

Os três perfis e o retorno a Desempenho passaram, usando HDR/AgX/FXAA.
As nove verificações locais de arquivos, controles, corpo, cabeça, projeção,
geometria da cama, tecido, engine e filtro de sombras passaram. O compilador
Intel voltou a emitir o aviso já observado no FXAA vendorizado durante o
teste da cama e a troca de perfis; não houve falha de compilação, JavaScript
ou renderização. Relatórios adicionais: `v0.7.0-movement-release` e
`v0.7.0-smoke-release`, dentro de `desktop/results/`.

Mudanças verificadas no conteúdo e na renderização:

- Tecidos: 90.000 → 34.934 triângulos, com cinco malhas. Cama completa com
  41.340 triângulos; quarto com 140.088. A comparação com a superfície densa
  de referência mede desvio máximo de aproximadamente 3,16 mm.
- Costuras e abas nos travesseiros, dobras de tensão, bainhas e borda retornada
  fina. Tecido com UV em metros, normal/rugosidade compartilhadas e mipmaps.
- Compilação estática: 543 → 125 malhas, preservando 262.245 vértices
  indexados, transformações e limites espaciais para descarte fora da câmera.
- Filtro de sombra pontual ajustado ao plano receptor. A contraprova numérica
  detecta 1.284 falsos sombreamentos no cálculo anterior e zero no novo, em
  2.699 interseções; obstáculos reais continuam projetando sombra.
- Capturas dos três lados confirmam a remoção das faixas no tecido, mantendo
  sombras dos travesseiros e das dobras. O mapa estático do abajur passa a
  1024 × 1024 por face, reutilizado entre quadros; o mapa humano continua
  independente em 512 × 512. Pequenos degraus ainda aparecem em algumas
  bordas no perfil Desempenho, com resolução interna de 1004 × 516.
- OCO Engine 0.1: pipeline HDR/AgX/FXAA, lotes estáticos, filtro de sombras e
  governador de resolução em módulos próprios, sobre Three.js/WebGL2.

Os relatórios locais da comparação ficam em
`desktop/results/v0.6.1-bed-baseline` e `desktop/results/v0.7.0-bed-release`.
Os comandos de reprodução estão em `desktop/README.md`.

## Referência da versão 0.6.1

Teste no aplicativo Windows, Intel Iris Xe (D3D11/ANGLE), com resolução interna
de 1004 × 516 no perfil Desempenho. O percurso de aproximadamente 35 segundos,
após aquecimento, incluiu caminhada, corrida e rotação da câmera pelo controle
real do jogo. Durante os 25 segundos de movimento:

| Medida | Resultado |
| --- | ---: |
| FPS renderizados | 59,38 |
| Tempo de quadro médio | 16,85 ms |
| Tempo de quadro p95 | 16,9 ms |
| Tempo de quadro p99 | 33,0 ms |
| CPU média | 2,72 ms |

A amostra final de 120 tempos de GPU marcou média de 11,20 ms e p95 de
16,78 ms. Houve quedas pontuais de quadros; a medição não representa 60 FPS
constantes nem garante o mesmo resultado em outras máquinas.

Capturas nativas com a mesma câmera confirmaram a cabeça sem abertura. Nos
três lados testados da cama, ligar/desligar a sombra humana produziu imagens
idênticas, como esperado para superfícies entre a luz e o jogador. Na parede,
a sombra escureceu 203.587 pixels sem clarear nenhum. O deslocamento junto à
cama percorreu 0,901 metro, com diferença máxima de 1,83 cm entre a posição do
jogador e a última atualização da sombra; o retorno à parede também passou.
Nenhuma partícula foi desenhada e nenhum erro foi registrado no teste nativo.

Regressões específicas corrigidas e verificadas:

- Cabeça selada: 82.110 raios em 42 direções e 17 poses sem vazamentos. A
  contraprova com a cabeça anterior detecta 171 passagens de luz indevidas.
- Profundidade do mapa humano gravada e lida em RGBA. Doze verificações
  confirmam iluminação antes do corpo e sombra depois dele, em relação à luz.
- 360 amostras sobre a cama permanecem iluminadas quando o jogador está além
  dela. O formato antigo produz 12 sombras impossíveis nesse mesmo teste.
- A projeção anterior desaparece ao deslocar o jogador. Mapa de 512 × 512,
  uma chamada de desenho e teto de 30 atualizações por segundo preservados.
- Malha com 6.164 triângulos; 180 poses aprovadas, com pés apoiados no piso.
- Sistema de partículas removido do carregamento e da atualização por quadro.
- Geometria do quarto, arquivos locais, caminhada, corrida, colisões, mouse e
  primeira pessoa aprovados pela suíte de testes.

## Referência da versão 0.6.0

Teste no aplicativo Windows, Intel Iris Xe (D3D11/ANGLE), com resolução interna
de 1004 × 516 no perfil Desempenho. Cada execução mediu aproximadamente
35 segundos após o aquecimento: parado, andando, girando, andando e girando,
e correndo e girando. Os comandos passaram pelo controlador do jogo.

Comparação da mesma cena e animação humana, com e sem a nova suavização:

| Durante o movimento | Direto, sem AA | FXAA adotado |
| --- | ---: | ---: |
| FPS renderizados | 60,00 | 59,72 |
| Tempo de quadro p95 | 16,9 ms | 16,9 ms |
| Tempo de quadro p99 | 17,0 ms | 17,1 ms |
| CPU média | 2,39 ms | 3,79 ms |
| GPU média | 11,91 ms | 12,57 ms |
| GPU p95 | 15,68 ms | 16,87 ms |

FXAA foi mantido como padrão: o custo médio de GPU medido foi de 0,66 ms,
com melhora visível nas bordas das molduras, do abajur e dos tecidos.
O caminho é HDR sem MSAA → AgX/sRGB → FXAA, sem conversão de cor duplicada.
Os números descrevem esta máquina, este percurso e esta resolução.

Outras verificações concluídas:

- Caminhada, corrida, rotação da câmera, avanço da passada e sombra móvel confirmados pelo teste nativo.
- Aceleração, frenagem, colisões, limites, reset e controle de mouse aprovados por testes locais.
- Oscilação da câmera limitada a 18 mm verticalmente e 9 mm lateralmente; ela assenta ao parar.
- Passada ligada à distância percorrida, sem continuar andando ao ficar bloqueado por móveis.
- Sombra humana com aproximadamente 6 mil triângulos em uma chamada de desenho, atualizada no máximo a 30 Hz.
- Quarto com 195.154 triângulos e sombras estáticas reutilizadas.
- Geometria, abertura da janela e arquivos locais aprovados por `npm test`.
- Nenhum erro de JavaScript ou falha de renderização nos testes nativos. O compilador Intel emitiu um aviso de derivadas no loop do shader FXAA vendorizado; os ramos e inicializações foram revisados, sem defeito visual observado.

Para reproduzir o percurso, consulte `desktop/README.md`. Para testes locais,
execute `npm test` com Node 22.15 ou superior.
