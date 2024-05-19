game-history.txt : output.jsonl watch.py
	cat $< | python watch.py > $@

output.jsonl : game.py
	python game.py | jq -c > $@
