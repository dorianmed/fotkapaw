import { useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface SearchBarProps {
  onResult: (lat: number, lng: number, label: string) => void;
}

const SearchBar = ({ onResult }: SearchBarProps) => {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`
      );
      const data = await res.json();
      if (data.length > 0) {
        onResult(parseFloat(data[0].lat), parseFloat(data[0].lon), data[0].display_name);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex gap-1">
      <Input
        placeholder="Szukaj miejsca..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSearch()}
        className="h-8 text-xs"
      />
      <Button variant="outline" size="sm" onClick={handleSearch} disabled={loading} className="h-8 px-2">
        <Search className="h-3 w-3" />
      </Button>
    </div>
  );
};

export default SearchBar;
