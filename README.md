# Controle de Gastos — Uso e Consumo

Aplicação de controle de solicitações e propostas de compra feita com HTML, CSS e JavaScript e Cloud Firestore. Não há tela de login; todos os visitantes usam uma lista compartilhada.

> **Atenção: acesso público.** As regras configuradas permitem que qualquer pessoa que consiga acessar o projeto/site leia, cadastre, edite e exclua todos os registros. Não armazene dados confidenciais. O link do site não funciona como senha ou controle de acesso.

## Preparar o Firebase

1. Crie um projeto no [Firebase Console](https://console.firebase.google.com/).
2. Em **Firestore Database**, crie um banco de dados.
3. Em **Configurações do projeto > Seus apps**, crie um app da Web e copie a configuração.
4. Substitua os valores de exemplo em `firebase-config.js` pelos valores do seu app.
5. No Firestore, abra a aba **Regras**, publique o conteúdo do arquivo `firestore.rules`.

Os registros novos são salvos na coleção compartilhada `expenses`. O site também consulta registros antigos em subcoleções chamadas `expenses`, como `users/{uid}/expenses`, para que possam aparecer na lista compartilhada. Publicar as regras substitui as regras anteriores; faça isso somente se estiver de acordo com o acesso público descrito acima.

Depois de publicar as regras, atualize também os arquivos do site no serviço de hospedagem e recarregue a página. Registros antigos aparecem na lista quando ainda existem no Firestore e estão em uma coleção chamada `expenses`.

## Executar localmente

Como a aplicação usa módulos JavaScript, abra os arquivos por um servidor HTTP local (não diretamente com `file://`). Por exemplo, com Node.js instalado:

```sh
npx serve .
```

Depois, acesse o endereço local informado pelo servidor.

## O que o site registra e calcula

- Data do pedido, setor solicitante, site/unidade, link, produto e valor solicitado.
- Os mesmos dados para a proposta do comprador.
- Relatório mensal ou anual, com totais solicitados, totais propostos e diferença.
- Consolidação por produto no período escolhido.
- Histórico com opção de editar e excluir registros.
- Exportação Excel (`.xlsx`) em formato de resumo: `MÊS/ANO` ou `ANO`, `VALOR SOLICITADO`, `VALOR DA COMPRA FINAL` e `DIFERENÇA`.

Os campos de link são opcionais. A data é obrigatória para que os relatórios mensais e anuais funcionem. Os valores aceitam vírgula ou ponto decimal com até duas casas; por exemplo, `123,45`. Eles são armazenados em centavos inteiros para manter a precisão dos totais.
