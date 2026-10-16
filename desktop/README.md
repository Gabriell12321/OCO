# Quarto 01 para Windows

Versão 0.5.0, exclusivamente em primeira pessoa. Empacotamento portátil com
Electron oficial 44.7.2 para Windows x64. O usuário
abre `Quarto 01.exe`; Node, navegador, instalação e internet não são necessários.

O perfil DESEMPENHO prioriza FPS; EQUILIBRADO aumenta a resolução interna;
QUALIDADE usa também suavização de bordas por MSAA4 em um alvo de renderização
próprio. A troca de perfil não exige reiniciar o aplicativo.

## Build

Na pasta do projeto, com Node 22.12 ou superior:

```powershell
node desktop/build.cjs
```

O builder baixa o runtime oficial somente se não estiver no cache e valida seu
SHA256 contra o valor publicado no `SHASUMS256.txt` da versão fixa. Não instala
pacotes, não modifica a política de execução do Windows e não altera o sistema.

Saídas: `../Windows/Quarto 01/Quarto 01.exe` e `../Quarto 01 Windows.zip`.

`--refresh` atualiza o conteúdo usando o runtime que já foi extraído. `--skip-zip`
omite a compactação durante as iterações de desenvolvimento.

## Diagnóstico do próprio aplicativo

```powershell
& '../Windows/Quarto 01/Quarto 01.exe' --benchmark '--benchmark-dir=C:\caminho\resultados'
```

O teste espera o quarto carregar, aquece por 5 segundos e mede aproximadamente
35 segundos: parado, andando, girando a câmera, andando e girando, e correndo e
girando. Os comandos passam pelo controlador real do próprio aplicativo.
Cada fase informa FPS realmente renderizados, tempo médio de CPU e tempos
de quadro p95/p99. O teste verifica posições, rotação, corrida, primeira pessoa
e a sombra que acompanha o jogador.

Ao concluir, grava `latest.json`, a vista inicial em `latest.png`, a sombra em
`shadow.png` e um detalhe do cobertor em `blanket.png`, e encerra o programa.
O relatório identifica a GPU efetivamente usada pelo contexto WebGL.
`--benchmark-quality=performance`, `balanced` ou `quality` permite medir um
perfil específico.

`--benchmark-msaa4` força MSAA4 no contexto para uma comparação técnica;
`--benchmark-no-msaa` força o contexto sem MSAA. Na execução normal, o contexto
direto prioriza desempenho e o perfil QUALIDADE usa seu próprio alvo MSAA4.

`--quality-steady-probe` separa a primeira ativação do perfil QUALIDADE de uma
amostra de 3 segundos já estabilizada, depois verifica a volta a DESEMPENHO.
`--capture-views-only` compara a sombra ligada e desligada na mesma câmera.

Se o shell de desenvolvimento herdou `ELECTRON_RUN_AS_NODE=1`, remova essa
variável apenas do processo que iniciará o teste. O atalho `ABRIR QUARTO.cmd`
prepara esse ambiente para a execução normal.

O programa serve seus próprios arquivos pelo protocolo `app://quarto`. O
renderer está em sandbox, sem integração Node e com isolamento de contexto.
O único IPC exposto recebe relatórios de desempenho. Requisições externas,
novas janelas e navegação remota são bloqueadas.

Fontes: [release oficial do Electron](https://github.com/electron/electron/releases/tag/v44.7.2),
[protocolo local](https://www.electronjs.org/docs/latest/api/protocol),
[segurança](https://www.electronjs.org/docs/latest/tutorial/security).
