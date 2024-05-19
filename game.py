import json
import sys

from pydantic import BaseModel


class GameState(BaseModel):
    board: 'Board'

class Board(BaseModel):
    grid: list[list]
    # TODO graph

def empty_grid(cols, rows):
    return [[None]*rows]*cols

def place_initial_pieces(board: Board) -> Board:
    board.grid[0] = [
        ('a', 3),
        ('a', 2,1,1),
        ('a', 1,1,1,1,1),
        ('a', 2,2),
        ('a', 3),
    ]

    board.grid[-1] = [
        ('b', 3),
        ('b', 2,2,2),
        ('b', 1,1,1,1,1),
        ('b', 2,1,1),
        ('b', 3),
    ]

    return board


def territory(board, row, col) -> tuple:
    return board.grid[row][col]


def move_piece(board: Board, army: str, piece: int, loc_i: tuple, loc_f: tuple) -> Board:

    row_i, col_i = loc_i
    territory_start = territory(board, row_i, col_i)
    assert territory_start[0] == army

    row_f, col_f = loc_f
    territory_end = territory(board, row_f, col_f)
    assert territory_end == None # TODO or occupied by us or enemy

    # set new t_i
    t_i = list(territory_start)
    pc_idx = t_i.index(piece)
    t_i.pop(pc_idx)
    board.grid[row_i][col_i] = tuple(t_i)

    # set new t_f
    t_f = (army, piece) # free space
    board.grid[row_f][col_f] = t_f

    return board


def main():

    board = Board(grid=empty_grid(5,5))
    print(json.dumps(board.dict()))

    board = place_initial_pieces(board)
    print(json.dumps(board.dict()))

    board = move_piece(board, 'a', 1, (0,1), (1,1))
    print(json.dumps(board.dict()))
    

if __name__ == '__main__':
    main()