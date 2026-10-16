# Validação da versão 0.9.0

Aplicativo Windows na Intel Iris Xe (D3D11/ANGLE), janela de 1900 × 977,
perfil Desempenho com FXAA e resolução interna fixa de 1004 × 516.
O teste de tempestade compara duas poses, cada uma com clarão desligado e
no pico, por três segundos após aquecimento. A chuva permanece ligada;
o áudio fica bloqueado nessa comparação para isolar o custo visual.

| Vista | Clarão | FPS | Quadro p95 | GPU média | Draw calls |
| --- | --- | ---: | ---: | ---: | ---: |
| Quarto | Desligado | 60,05 | 16,8 ms | 11,98 ms | 99 |
| Quarto | Pico vermelho | 60,13 | 16,8 ms | 11,40 ms | 99 |
| Janela | Desligado | 60,29 | 16,8 ms | 8,67 ms | 68 |
| Janela | Pico vermelho | 60,04 | 16,8 ms | 8,65 ms | 68 |

Todas as fases tiveram foco, cobertura temporal, câmera e resolução válidos,
sem repetição. As pequenas diferenças estão dentro da variação de amostras
curtas limitadas a 60 Hz; não demonstram ganho de GPU causado pelo clarão.
Os pares mantêm exatamente a mesma contagem de triângulos e draw calls.
A revisão do código confirmou que a mudança altera cores e intensidades,
preservando os mapas de sombra. Nenhum emissor ou passe foi acrescentado.

As capturas nativas foram inspecionadas: o vermelho atinge cortinas, cama,
paredes e vidro a partir da janela, com sombras e textura preservadas.
As regiões de análise identificaram 116.034 pixels com mudança vermelha na
parede e 75.812 na cama; os estilos e elementos da interface permaneceram
iguais. O efeito não usa uma camada de cor sobre a tela.

## Áudio e sincronismo

O aplicativo confirmou `local-recording` para chuva e trovão, sem erros de
leitura ou decodificação. A chuva tem um ciclo efetivo de 22,402 s, com
crossfade circular de 600 ms. O trovão remove 530 ms de início da gravação:
o ataque detectado fica a 10 ms do novo início, e a duração final é de 7 s.

O PCM dos primeiros 200 ms do trovão apresentou RMS 0,11268 e pico 0,47506.
Na saída final, a chuva isolada teve RMS 0,00741/pico 0,02803; durante o
ataque do trovão, RMS 0,11414/pico 0,34012. As amostras medidas não saturaram.
O teste valida o sinal digital; não substitui uma avaliação auditiva com
os alto-falantes ou fones do jogador.

Na timeline real, um evento visual e um evento de áudio apareceram na mesma
sondagem aos 10,0498 s. O ganho do clarão subiu e voltou a zero, compatível
com seu envelope de 1,05 s. Isso verifica o acionamento compartilhado no
aplicativo; a latência acústica física do dispositivo não foi medida.
Não há atraso intencional entre luz e trovão.

Mute e pausa produziram silêncio. Silenciar durante um evento não deixou
trovão pendente para tocar depois; pausar durante o trovão encerrou a voz,
congelou o relógio da cena e retomou a chuva sem repetir o trovão antigo.
O limite de um trovão simultâneo foi respeitado. Relatório:
`desktop/results/v0.9.0-storm-first/latest.json`, aprovado, sem erros ou avisos.

## Percurso e regressões

O percurso de 35,077 s teve chuva, piscadas, gravações de áudio e tempestade
ativos. O teste exigiu e registrou um clarão e um trovão durante a medição,
além de caminhada, corrida e movimento do mouse. A resolução ficou em
1004 × 516, sem pausas, interrupções ou repetição de fases.

| Medida | Percurso completo | Trechos em movimento |
| --- | ---: | ---: |
| FPS renderizados | 60,01 | 60,01 |
| Quadro médio | 16,67 ms | 16,67 ms |
| Quadro p95 | 16,8 ms | 16,8 ms |
| Quadro p99 | 16,9 ms | 16,9 ms |
| CPU média | 3,22 ms | 3,24 ms |
| Quadros medidos | 2.105 | 1.503 |

O aplicativo não registrou erros ou avisos. A regressão da sombra humana
passou com a atmosfera congelada e atraso espacial máximo de 1,85 cm;
nenhuma partícula interna foi renderizada. Relatório:
`desktop/results/v0.9.0-movement-final/latest.json`.

A troca Desempenho → Equilibrado → Qualidade → Desempenho passou, com
resoluções de 1004 × 516, 1338 × 688 e 1582 × 812, sem erros ou avisos.
A captura adicional do clarão em Qualidade foi revisada. Esse ciclo verifica
funcionamento e aparência; não é um benchmark sustentado de FPS dos perfis
mais pesados. Relatório: `desktop/results/v0.9.0-smoke-final/latest.json`.
Os números de desempenho acima descrevem esta máquina e este percurso;
não garantem o mesmo FPS em outros equipamentos ou perfis.

As doze verificações locais passaram: arquivos/geometria, primeira pessoa,
corpo humano, cabeça selada, projeção da sombra, cama, tecido, engine,
filtro de sombras, iluminação, chuva e áudio. A revisão independente
aprovou main, iluminação e áudio. Foram corrigidos na revisão a costura
que podia introduzir um baque grave e os casos de cancelamento/recorte do
trovão; os testes cobrem esses comportamentos.

## Referência da versão 0.8.0

Aplicativo Windows na Intel Iris Xe (D3D11/ANGLE), janela de 1900 × 977,
perfil Desempenho com FXAA e resolução interna fixa de 1004 × 516.
As vistas da janela foram medidas por quatro segundos após aquecimento,
mantendo a câmera e a iluminação iguais, com chuva desligada e ligada.
O áudio permaneceu bloqueado nessa comparação para isolar o custo visual.

| Vista | Chuva | FPS | Quadro p95 | GPU média |
| --- | --- | ---: | ---: | ---: |
| Janela | Desligada | 60,20 | 16,8 ms | 8,42 ms |
| Janela | Ligada | 60,01 | 16,9 ms | 8,35 ms |
| Vidro de perto | Desligada | 60,02 | 16,9 ms | 7,50 ms |
| Vidro de perto | Ligada | 60,11 | 16,9 ms | 7,27 ms |

As pequenas diferenças de GPU ficam dentro da variação destas amostras
curtas; não significam que adicionar chuva acelere a GPU. A apresentação
é limitada a 60 Hz e a contagem sobre intervalos curtos pode arredondar
ligeiramente acima de 60 FPS. Estes números descrevem esta máquina e este
perfil, sem garantir o mesmo desempenho em outras configurações.

O percurso final de 35,07 segundos foi medido com **chuva, piscadas e áudio
ativos**, incluindo caminhada, corrida e rotação da câmera. Todas as fases
tiveram cobertura temporal válida, sem pausas nem repetição:

| Medida | Percurso completo | Trechos de movimento |
| --- | ---: | ---: |
| FPS renderizados | 60,02 | 60,02 |
| Quadro médio | 16,67 ms | 16,67 ms |
| Quadro p95 | 16,9 ms | 16,8 ms |
| Quadro p99 | 16,9 ms | 16,9 ms |
| CPU média | 3,44 ms | 3,46 ms |

O áudio estava desbloqueado e com sinal medido antes do aquecimento. A chuva
permaneceu ativa e a escala permaneceu em 1004 × 516. Não houve erros no
percurso. Relatório: `desktop/results/v0.8.0-movement-final/latest.json`.

O teste verifica foco, pausa, visibilidade e cobertura temporal. Uma amostra
interrompida é registrada e repetida, com limite de três tentativas. Só são
aceitas fases cuja soma dos tempos de quadro difere do tempo medido em menos
de 150 ms. As primeiras medições interrompidas por perda de foco foram
descartadas; o teste final também registrou uma repetição antes de obter as
quatro amostras válidas acima.

Capturas nativas em Desempenho e Qualidade confirmaram filetes de chuva fora
do quarto, gotas e escorrimentos no vidro, molduras ocluindo a água e reflexos
mais discretos. As comparações de chuva usam a mesma pose e o mesmo instante
congelado. Os buffers de instâncias permanecem constantes; a animação muda
somente uniforms. A chuva usa dois lotes e 1.680 triângulos em Desempenho.

O teste da piscada confirmou duas quedas de luz e dois estalos correspondentes,
com ganho mínimo observado de 0,09. Luz direta, preenchimento quente, cúpula,
filamento e reflexo nas gotas compartilham esse ganho. Nenhuma piscada
invalida os mapas estáticos de sombra. A sequência usa falhas espaçadas,
com recuperação gradual, em vez de brilho aleatório a cada quadro.

O teste específico de áudio passou. O dispositivo precisou de 595 ms de
tempo real para avançar 112 ms no relógio do AudioContext e estabilizar o
ganho em 0,72. Depois disso, o sinal final apresentou RMS de 0,03846 e pico
de 0,14279, sem saturação. Mute e pausa produziram RMS e pico zero; a retomada
voltou a produzir sinal (RMS 0,04562). Foram confirmados dois eventos de luz
e dois estalos. Não houve áudio nem criação de contexto antes da interação.
O teste mantém o requisito de sinal não nulo e falha se o dispositivo não
estabilizar em até três segundos. Relatório: `v0.8.0-audio-final/latest.json`.

Relatório visual e de custo da chuva:
`desktop/results/v0.8.0-weather-final/latest.json`. O resultado agregado dessa
rodada sinalizou a inicialização do dispositivo de áudio, esclarecida e
validada pelo teste específico acima; as quatro fases de renderização têm
integridade temporal válida. Os comandos estão em `desktop/README.md`.

As doze verificações locais passaram: arquivos e geometria do quarto,
controles, corpo humano, cabeça selada, profundidade da sombra, cama, tecido,
engine, filtro de sombras, iluminação, chuva e áudio. A inspeção independente
do código não encontrou bloqueios. A troca dos três perfis gráficos e o
retorno a Desempenho passaram sem erros ou avisos nessa execução
(`desktop/results/v0.8.0-smoke-final/latest.json`).

Na regressão da sombra humana, a atmosfera foi congelada para comparar
imagens idênticas. Os três lados da cama tiveram diferença zero entre sombra
ligada e desligada. Na parede, foram escurecidos 203.418 pixels e nenhum foi
clareado. A sombra acompanhou o jogador com atraso espacial máximo de 1,88 cm.
Nenhuma partícula foi desenhada dentro do quarto.

## Referência da versão 0.7.0

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
