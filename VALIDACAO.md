# Validação da versão 0.5.0

Teste no aplicativo Windows, Intel Iris Xe (D3D11/ANGLE), com resolução interna
de 1004 × 516 no perfil Desempenho. Cada execução mediu aproximadamente
35 segundos após o aquecimento: parado, andando, girando, andando e girando,
e correndo e girando. Os comandos passaram pelo controlador do jogo.

Comparação do mesmo renderizador com e sem MSAA no contexto:

| Durante o movimento | MSAA 4× | Direto, sem MSAA |
| --- | ---: | ---: |
| FPS renderizados | 56,45 | 60,01 |
| Tempo de quadro p95 | 33,2 ms | 16,9 ms |
| Tempo de quadro p99 | 33,5 ms | 16,9 ms |
| CPU média | 2,78 ms | 2,04 ms |

O caminho direto foi adotado nos perfis Desempenho e Equilibrado. Qualidade
usa um alvo HDR com MSAA 4× e conversão de cor AgX. O teste curto final
conferiu a troca entre os três perfis e o retorno ao caminho direto, sem
reiniciar. Os números acima descrevem esta máquina e esta resolução.

Outras verificações concluídas:

- Caminhada, corrida, rotação da câmera e sombra móvel confirmadas pelo teste.
- Primeira pessoa, altura dos olhos, colisões, limites do quarto e reset aprovados.
- Sombra articulada conferida visualmente, ligada e desligada na mesma posição.
- Quarto com 195.154 triângulos; sombra humana com 964 triângulos e uma chamada de desenho própria.
- Geometria, abertura da janela e arquivos locais aprovados por `npm test`.
- Nenhum erro de JavaScript ou WebGL nos testes nativos.

Para reproduzir o percurso, consulte `desktop/README.md`.
