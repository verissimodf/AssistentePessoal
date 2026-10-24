# Reporta qual componente filho terminou — diagnóstico de reinícios do container.
#
# O entrypoint sobe API, ponte de voz e painel e usa `wait -n` para encerrar o conjunto quando
# qualquer um morre (o Docker então reinicia tudo). Sem registrar QUAL filho saiu, um reinício
# gracioso (exit 0) fica sem causa determinável — foi o caso das duas reinicializações de 24/10.
#
# Uso: wait_for_first_exit "${pids[@]}"
wait_for_first_exit() {
  local -a pids=("$@")
  local finished_pid="" status=0 i

  if [[ "${EXIT_REPORTER_FORCE_FALLBACK:-0}" != "1" ]] &&
    ((BASH_VERSINFO[0] > 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] >= 1))); then
    wait -n -p finished_pid
    status=$?
  else
    wait -n
    status=$?
  fi

  for i in "${!pids[@]}"; do
    if [[ -n "$finished_pid" && "${pids[$i]}" == "$finished_pid" ]]; then
      echo "assistente-pessoal: componente $i (pid $finished_pid) terminou (status=$status); encerrando o conjunto para o Docker reiniciar" >&2
      return "$status"
    fi
  done
  echo "assistente-pessoal: componente desconhecido terminou (status=$status); encerrando o conjunto para o Docker reiniciar" >&2
  return "$status"
}
