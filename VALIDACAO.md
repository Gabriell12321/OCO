# Validação da versão 0.6.0

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
