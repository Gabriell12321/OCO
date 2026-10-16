# Validação da versão 0.6.1

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
