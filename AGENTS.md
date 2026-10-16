# Trabalho neste projeto

O usuário autorizou manter as atualizações concluídas no GitHub:
`https://github.com/Gabriell12321/OCO.git`.

- Depois de implementar e validar uma atualização solicitada, faça commit e push para esse repositório. Confira o estado remoto antes de enviar; preserve o histórico e não faça force push.
- Autor dos commits: Gabriel, `gargarciademello@gmail.com`.
- Mantenha o jogo exclusivamente em primeira pessoa e dentro deste único quarto, até uma instrução diferente do usuário.
- Ao avaliar fluidez, teste caminhada, corrida e movimento do mouse. Informe FPS e frametimes realmente medidos.
- O aplicativo Windows é empacotado com `node desktop/build.cjs`. Não altere a política de execução do Windows.
- Credenciais são locais. Nunca inclua tokens, arquivos privados, caches, node_modules, logs de autenticação ou o runtime Windows nos commits/pacotes de código.
- Nesta estação, o helper `scripts/github-credential.cjs` usa a credencial criptografada do Windows em `../.private/GITHUB.md`, fora da raiz Git. Não execute o helper manualmente imprimindo sua saída; o Git é o consumidor do canal de credenciais.
- O ZIP Windows pode acompanhar uma versão em GitHub Releases, separado do histórico Git.
